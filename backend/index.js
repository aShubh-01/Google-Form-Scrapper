/**
 * index.js
 * Entry point for the Google Form auto-filler.
 *
 * Flow per submission:
 *   1. Open form URL in Puppeteer
 *   2. LOOP over pages:
 *      a. Extract all questions on current page (parse data-params)
 *      b. For each question → ask AI to generate an appropriate answer
 *      c. Fill the field with the correct Puppeteer interaction
 *      d. If Submit button present → submit → verify confirmation
 *         Else → click Next → go back to step (a)
 *   3. Wait delayBetweenSubmissions ms → repeat for next submission
 */

import "dotenv/config";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
// payload imported programmatically now
import identities from "./identities.json" with { type: "json" };

// --- Internal modules ---
import {
  extractFormContext,
  extractFormQuestions,
  isLastPage,
  isConfirmationPage,
  getPageHistory,
  clickNext,
  clickSubmit,
  fillField,
  sleep,
  log,
} from "./helpers.js";

import { initAI, generatePageAnswers, generateRandomDate, generateRandomTime, getRandomTone, getRandomBehavior } from "./ai.js";

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

export async function runScraper(payload) {
  const { formUrl, numberOfResponses, options = {} } = payload;
  const {
    delayBetweenSubmissions = 2000,
    headless = false,
    verbose = true,
    concurrentSubmissions = 1,
  } = options;

  // 1. Validate payload
  if (!formUrl || !numberOfResponses) {
    throw new Error("Missing `formUrl` or `numberOfResponses` in payload");
  }

  log(`🚀 Google Form Auto-filler`);
  log(`   URL      : ${formUrl}`);
  log(`   Responses: ${numberOfResponses}`);

  // 2. Initialize Gemini AI
  initAI();

  let successCount = 0;
  let failCount = 0;

  // ---------------------------------------------------------------------------
  // Submission loop
  // ---------------------------------------------------------------------------

  const processSubmission = async (i) => {
    log(`\n${"─".repeat(60)}`);
    log(`📋 Starting Submission ${i + 1} of ${numberOfResponses}`);
    log(`${"─".repeat(60)}`);

    let browser;
    try {
      const isLocal = process.platform === "darwin" || process.platform === "win32";
      browser = await puppeteer.launch({
        args: isLocal ? [] : chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: isLocal
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : await chromium.executablePath(),
        headless: isLocal ? true : chromium.headless,
      });

      const page = await browser.newPage();

      // Set a realistic user-agent to reduce bot-detection risk
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      );

      // --- Navigate to form ---
      await page.goto(formUrl, { waitUntil: "networkidle2" });

      // Shared context across all pages so AI keeps answers consistent
      const identity = identities[Math.floor(Math.random() * identities.length)];
      const context = {
        previousAnswers: {},
        identity,
        tone: getRandomTone(),
        behavior: getRandomBehavior()
      };
      log(`\n👤 [Sub ${i + 1}] Identity selected: ${identity.name} (${identity.email})`);

      let pageNumber = 1;

      // Extract form info (title and description) on the first page
      const formInfo = await extractFormContext(page);
      if (formInfo.title || formInfo.desc) {
        context.formInfo = formInfo;
      }

      // -----------------------------------------------------------------------
      // Page loop  (keep going until form is submitted or an error occurs)
      // -----------------------------------------------------------------------
      while (true) {
        const pageHistory = await getPageHistory(page);
        log(`\n📄 [Sub ${i + 1}] Page ${pageNumber}  (history: ${pageHistory})`);

        // Step 0: Check for top-level required email field (e.g., "Collect verified emails")
        try {
          log(`[Sub ${i + 1}] 🔍 Scanning for email input field...`);
          const emailInput = await page.$('input[type="email"]');
          if (emailInput) {
            log(`[Sub ${i + 1}] 📧 Email input element found in DOM! Checking value...`);
            const val = await page.evaluate(el => el.value, emailInput);
            log(`[Sub ${i + 1}] 📧 Email input current value is: "${val}"`);

            if (!val) {
              log(`[Sub ${i + 1}] 📧 Filling with persona email: ${context.identity.email}`);
              await emailInput.type(context.identity.email, { delay: 30 });
              await sleep(500);
            } else {
              log(`[Sub ${i + 1}] 📧 Email field already has a value, skipping typing.`);
            }
          } else {
            log(`[Sub ${i + 1}] ⚠️ No input[type="email"] element found on this page.`);
          }
        } catch (err) {
          log(`[Sub ${i + 1}] ❌ Error during email field processing: ${err.message}`);
        }

        // Step A: Extract all questions on this page
        const questions = await extractFormQuestions(page);

        if (questions.length === 0) {
          log(`[Sub ${i + 1}] ⚠️  No questions found on this page — skipping to next or submit.`);
        } else {
          if (verbose) {
            log(`[Sub ${i + 1}] Found ${questions.length} question(s):`);
            questions.forEach((q, idx) =>
              log(`   ${idx + 1}. [${q.type}] ${q.title}`)
            );
          }

          // Step B: Ask AI to generate answers for ALL questions on this page in ONE go
          let pageAnswers = {};
          try {
            pageAnswers = await generatePageAnswers(questions, context);
          } catch (err) {
            console.error(`[Sub ${i + 1}] ⚠️  Failed to generate batch answers from AI:`, err);
            // Fallback: empty answers if AI fails entirely
            pageAnswers = {};
          }

          // Step C: Fill the fields using the generated answers
          for (const question of questions) {
            log(`\n[Sub ${i + 1}] ❓ "${question.title}"  (${question.type})`);

            let answer = pageAnswers[question.title];

            // Fallback for dates/times which are not AI generated or if AI missed it
            if (answer === undefined) {
              if (question.type === "DATE") answer = generateRandomDate();
              else if (question.type === "TIME") answer = generateRandomTime();
              else answer = "";
            }

            await fillField(page, question, answer);

            // Track for cross-question consistency on next pages
            context.previousAnswers[question.title] = answer;

            if (verbose) log(`         [Sub ${i + 1}] ✅ Answer: ${JSON.stringify(answer)}`);

            await sleep(300); // small gap between fields
          }
        }

        // Step D: Submit or go to Next page
        const onLastPage = await isLastPage(page);

        if (onLastPage) {
          // ---- Submit ----
          log(`\n[Sub ${i + 1}] 🏁 Last page — clicking Submit...`);
          await clickSubmit(page);

          // Verify confirmation
          if (await isConfirmationPage(page)) {
            log(`[Sub ${i + 1}] ✅ Submission confirmed: "Your response has been recorded."`);
            successCount++;
          } else {
            console.warn(`[Sub ${i + 1}] ⚠️  Submit clicked but confirmation not detected.`);
            successCount++;  // count it anyway — form may have redirected
          }

          break; // exit page loop for this submission

        } else {
          // ---- Next page ----
          log(`\n[Sub ${i + 1}] ➡️  Clicking Next...`);
          await clickNext(page);
          pageNumber++;
          await sleep(500); // let page settle
        }
      }

    } catch (err) {
      console.error(`[Sub ${i + 1}] ❌ Submission failed: ${err.message}`);
      if (verbose) console.error(err.stack);
      failCount++;
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    if (delayBetweenSubmissions > 0) {
      await sleep(delayBetweenSubmissions);
    }
  };

  const executing = new Set();
  for (let i = 0; i < numberOfResponses; i++) {
    const p = processSubmission(i).catch(console.error);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean);

    if (executing.size >= concurrentSubmissions) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);

  // ---------------------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------------------
  log(`\n${"═".repeat(60)}`);
  log(`🎉 All done!  ✅ ${successCount} succeeded  |  ❌ ${failCount} failed`);
  log(`${"═".repeat(60)}\n`);
  return { successCount, failCount };
}

export async function checkFormAccess(formUrl) {
  let browser;
  try {
    const isLocal = process.platform === "darwin" || process.platform === "win32";
    browser = await puppeteer.launch({
      args: isLocal ? [] : chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: isLocal
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : await chromium.executablePath(),
      headless: isLocal ? true : chromium.headless,
    });
    const page = await browser.newPage();

    await page.goto(formUrl, { waitUntil: "networkidle2" });

    // Check if redirected to Google Login
    if (page.url().includes("accounts.google.com/ServiceLogin") || page.url().includes("accounts.google.com/signin")) {
      return { requiresLogin: true };
    }

    // Check for "Sign in to continue" modal/text within the page
    const loginTextExists = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes("Sign in to continue") ||
        bodyText.includes("To fill out this form, you must be signed in") ||
        bodyText.includes("Sign in to your Google Account");
    });

    if (loginTextExists) {
      return { requiresLogin: true };
    }

    return { requiresLogin: false };
  } catch (err) {
    console.error("[checkFormAccess] Error:", err);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}
