/**
 * helpers.js
 * Scraping and interaction logic for Google Forms.
 *
 * data-params format: "%.@.[questionArray],"i1","i2","i3",required,"i4"]"
 * Fix: prepend "[" after stripping "%.@." to make it valid JSON.
 * wrapper[0] = question data array
 * wrapper[0][0] = questionId, [1] = title, [3] = typeCode, [4] = [[entryId, options, ...]]
 */

import * as SEL from "./selectors.js";

// ---------------------------------------------------------------------------
// Field Type Constants & Type-Code Map
// ---------------------------------------------------------------------------

export const FIELD_TYPES = {
  SHORT_TEXT:      "SHORT_TEXT",
  LONG_TEXT:       "LONG_TEXT",
  MULTIPLE_CHOICE: "MULTIPLE_CHOICE",
  CHECKBOX:        "CHECKBOX",
  DROPDOWN:        "DROPDOWN",
  LINEAR_SCALE:    "LINEAR_SCALE",
  DATE:            "DATE",
  TIME:            "TIME",
  UNKNOWN:         "UNKNOWN",
};

// ---------------------------------------------------------------------------
// Question Extraction
// ---------------------------------------------------------------------------

export async function extractFormContext(page) {
  return await page.evaluate(() => {
    const title = document.querySelector('div[role="heading"][aria-level="1"]')?.innerText?.trim() || '';
    const desc = document.querySelector('.F3ElKe, .ZWBKjd')?.innerText?.trim() || '';
    return { title, desc };
  });
}

export async function extractFormQuestions(page) {
  return page.evaluate(() => {
    const TYPE_CODE_MAP = {
      0: "SHORT_TEXT", 1: "LONG_TEXT", 2: "MULTIPLE_CHOICE",
      3: "DROPDOWN",   4: "CHECKBOX",  5: "LINEAR_SCALE",
      9: "DATE",      10: "TIME",    18: "LINEAR_SCALE", // Rating (Stars) uses same logic as Linear Scale
    };

    const blocks = document.querySelectorAll('[jsmodel="CP1oW"][data-params]');

    return Array.from(blocks).map((block) => {
      const raw = block.getAttribute("data-params") || "";
      // Prepend "[" after stripping "%.@." → valid wrapper array
      const jsonStr = raw.startsWith("%.@.") ? "[" + raw.slice(4) : raw;

      let questionId = null, entryId = null, title = "", typeCode = -1,
          options = [], required = false, scaleMin = null, scaleMax = null;

      try {
        const wrapper = JSON.parse(jsonStr);
        const q = wrapper[0];

        questionId = q[0];
        title      = q[1] || "";
        typeCode   = q[3];

        const group = Array.isArray(q[4]) && q[4][0];
        if (group) {
          entryId = group[0];
          const rawOpts = group[1];
          if (Array.isArray(rawOpts)) {
            options = rawOpts.map((o) => (Array.isArray(o) ? o[0] : null)).filter(Boolean);
          }
        }

        required = wrapper[4] === true;

        if (typeCode === 5) {
          const pts = block.querySelectorAll('[role="radio"][data-value]');
          const vals = Array.from(pts).map((el) => parseInt(el.getAttribute("data-value"), 10)).filter((n) => !isNaN(n));
          if (vals.length) { scaleMin = Math.min(...vals); scaleMax = Math.max(...vals); }
        }
      } catch (_) {
        title = block.querySelector(".M7eMe")?.innerText?.trim() || "";
      }

      return {
        questionId, entryId,
        title: title.trim(),
        typeCode,
        type: TYPE_CODE_MAP[typeCode] || "UNKNOWN",
        options, required, scaleMin, scaleMax,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Page State Helpers
// ---------------------------------------------------------------------------

export async function isLastPage(page) {
  return (await page.$(SEL.SUBMIT_BUTTON)) !== null;
}

export async function getPageHistory(page) {
  return page.$eval(SEL.PAGE_HISTORY_INPUT, (el) => el.value).catch(() => "unknown");
}

export async function isConfirmationPage(page) {
  try {
    // Try the specific class first, or look for common confirmation link
    const el = await page.waitForSelector(`${SEL.CONFIRMATION_MSG}, ${SEL.SUBMIT_ANOTHER_LINK}, .vHW8K`, { timeout: 5000 });
    return el !== null;
  } catch (err) {
    // Fallback: check if page text contains "recorded" or "received"
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes("recorded") || text.includes("received") || text.includes("Submit another response")) {
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export async function clickNext(page) {
  const NAV_TIMEOUT = 15_000;
  
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: NAV_TIMEOUT }),
      page.click(SEL.NEXT_BUTTON)
    ]);
  } catch (err) {
    // Check if it's blocked by validation
    await sleep(500); // give validation UI time to appear
    const validationVisible = await page.evaluate(() => {
      const alerts = document.querySelectorAll('[role="alert"]');
      return Array.from(alerts).some((el) => el.innerText?.trim().length > 0);
    });
    
    if (validationVisible) {
      throw new Error("[helpers] Form validation blocked Next — a required field was not filled correctly.");
    }
    
    // Sometimes Puppeteer throws "Navigating frame was detached" or timeout on SPA transitions.
    // If no validation error, assume it succeeded and just wait for the new page questions to render.
    await page.waitForSelector('[jsmodel="CP1oW"][data-params]', { timeout: 5000 }).catch(() => {});
  }
}

export async function clickSubmit(page) {
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15_000 }),
      page.click(SEL.SUBMIT_BUTTON),
    ]);
  } catch (err) {
    // Similar to Next, ignore navigation errors if the confirmation message appears
    await page.waitForSelector(SEL.CONFIRMATION_MSG, { timeout: 5000 }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Field Router
// ---------------------------------------------------------------------------

export async function fillField(page, question, answer) {
  const { type, title } = question;
  switch (type) {
    case FIELD_TYPES.SHORT_TEXT:      await fillShortText(page, question, String(answer)); break;
    case FIELD_TYPES.LONG_TEXT:       await fillLongText(page, question, String(answer)); break;
    case FIELD_TYPES.MULTIPLE_CHOICE: await selectRadioOption(page, question, String(answer)); break;
    case FIELD_TYPES.CHECKBOX:        await selectCheckboxOptions(page, question, Array.isArray(answer) ? answer : [String(answer)]); break;
    case FIELD_TYPES.DROPDOWN:        await selectDropdownOption(page, question, String(answer)); break;
    case FIELD_TYPES.LINEAR_SCALE:    await selectScalePoint(page, question, Number(answer)); break;
    case FIELD_TYPES.DATE:            await fillDateField(page, question, String(answer)); break;
    case FIELD_TYPES.TIME:            await fillTimeField(page, question, String(answer)); break;
    default: console.warn(`[helpers] Unknown type "${type}" for "${title}" — skipping.`);
  }
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

async function fillShortText(page, question, answer) {
  const block = await getQuestionBlock(page, question);
  const input = await block.$(SEL.SHORT_TEXT_INPUT);
  if (!input) throw new Error(`[helpers] Short-text input not found: "${question.title}"`);
  await input.click({ clickCount: 3 });
  await input.type(answer, { delay: 30 });
}

async function fillLongText(page, question, answer) {
  const block = await getQuestionBlock(page, question);
  const ta = await block.$(SEL.LONG_TEXT_INPUT);
  if (!ta) throw new Error(`[helpers] Textarea not found: "${question.title}"`);
  await ta.click({ clickCount: 3 });
  await ta.type(answer, { delay: 20 });
}

async function selectRadioOption(page, question, value) {
  const block = await getQuestionBlock(page, question);
  const radios = await block.$$('[role="radio"]');
  let matched = null;

  for (const radio of radios) {
    const dv = await radio.evaluate((el) => el.getAttribute("data-value"));
    if (dv && dv.trim() === value.trim()) { matched = radio; break; }
  }

  if (!matched) {
    console.warn(`[helpers] Radio value "${value}" not found in "${question.title}" — picking first.`);
    matched = radios[0];
  }

  const clickTarget = await matched.$("div.vd3tt");
  if (clickTarget) await clickTarget.click();
  else await matched.click();
}

/**
 * Checks checkboxes matching `values`. Uses page-wide search by data-value
 * to avoid fragile block-title lookup issues.
 */
async function selectCheckboxOptions(page, question, values) {
  const checkboxes = await page.$$('[role="checkbox"]');
  let clickedAny = false;

  for (const checkbox of checkboxes) {
    const dv = await checkbox.evaluate((el) => el.getAttribute("data-answer-value"));
    if (!dv) continue;

    const shouldCheck = values.some((v) => v.trim().toLowerCase() === dv.trim().toLowerCase());
    if (!shouldCheck) continue;

    const alreadyChecked = await checkbox.evaluate((el) => el.getAttribute("aria-checked") === "true");
    if (alreadyChecked) { clickedAny = true; continue; }

    // Click the visual box (div.uHMk6b) as identified in the Puppeteer recording
    const visualBox = await checkbox.$("div.uHMk6b");
    if (visualBox) {
      await visualBox.click();
    } else {
      // Fallback: find and click the label
      const label = await checkbox.evaluateHandle((el) => el.closest("label") || el);
      await label.click();
    }
    await sleep(250);

    // Verify; dispatch JS click if still unchecked
    const nowChecked = await checkbox.evaluate((el) => el.getAttribute("aria-checked") === "true");
    if (!nowChecked) {
      await checkbox.evaluate((el) => el.click());
      await sleep(150);
    }
    clickedAny = true;
  }

  if (!clickedAny && values.length > 0) {
    console.warn(`[helpers] Checkbox values ${JSON.stringify(values)} not matched for "${question.title}".`);
  }
}

async function selectDropdownOption(page, question, value) {
  const block = await getQuestionBlock(page, question);
  const trigger = await block.$(SEL.DROPDOWN_TRIGGER);
  if (!trigger) throw new Error(`[helpers] Dropdown not found: "${question.title}"`);
  await trigger.click();
  await sleep(400);

  await page.waitForSelector(SEL.DROPDOWN_OPTION);
  const options = await page.$$(SEL.DROPDOWN_OPTION);

  for (const opt of options) {
    const text = await opt.evaluate((el) => el.innerText?.trim());
    if (text && text.toLowerCase() === value.toLowerCase()) { await opt.click(); return; }
  }

  console.warn(`[helpers] Dropdown value "${value}" not found — picking first.`);
  if (options[0]) await options[0].click();
}

async function selectScalePoint(page, question, value) {
  const block = await getQuestionBlock(page, question);
  const point = await block.$(`[role="radio"][data-value="${value}"]`);

  if (!point) {
    console.warn(`[helpers] Scale point "${value}" not found — picking middle.`);
    const mid = Math.round(((question.scaleMin || 1) + (question.scaleMax || 5)) / 2);
    const midPoint = await block.$(`[role="radio"][data-value="${mid}"]`);
    if (midPoint) await midPoint.click();
    return;
  }

  const clickTarget = await point.$("div.vd3tt");
  if (clickTarget) await clickTarget.click();
  else await point.click();
}

async function fillDateField(page, question, dateStr) {
  // Ensure dateStr is YYYY-MM-DD
  let formattedDate = dateStr;
  if (dateStr.includes("/")) {
    // try to convert DD/MM/YYYY or MM/DD/YYYY to YYYY-MM-DD (rough guess)
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      if (parts[2].length === 4) formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }

  const block = await getQuestionBlock(page, question);
  
  // Try new single date input first
  const dateInput = await block.$(SEL.DATE_INPUT);
  if (dateInput) {
    // evaluate setting value directly. Do NOT use .type() as it conflicts.
    await dateInput.evaluate((el, val) => {
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    }, formattedDate);
    return;
  }

  // Fallback to legacy 3-field date
  const [year, month, day] = formattedDate.split("-");
  const yearInput  = await block.$(SEL.DATE_YEAR_INPUT);
  const monthInput = await block.$(SEL.DATE_MONTH_INPUT);
  const dayInput   = await block.$(SEL.DATE_DAY_INPUT);
  if (monthInput) { await monthInput.click({ clickCount: 3 }); await monthInput.type(month); }
  if (dayInput)   { await dayInput.click({ clickCount: 3 }); await dayInput.type(day); }
  if (yearInput)  { await yearInput.click({ clickCount: 3 }); await yearInput.type(year); }
}

async function fillTimeField(page, question, timeStr) {
  const [hour, minute] = timeStr.split(":");
  const block = await getQuestionBlock(page, question);
  const hourInput   = await block.$(SEL.TIME_HOUR_INPUT);
  const minuteInput = await block.$(SEL.TIME_MINUTE_INPUT);
  if (hourInput)   { await hourInput.click({ clickCount: 3 }); await hourInput.type(hour); }
  if (minuteInput) { await minuteInput.click({ clickCount: 3 }); await minuteInput.type(minute); }
}

// ---------------------------------------------------------------------------
// Block Locator (by normalized title)
// ---------------------------------------------------------------------------

async function getQuestionBlock(page, question) {
  const blocks = await page.$$('[jsmodel="CP1oW"][data-params]');
  const needle = question.title.trim().replace(/\s+/g, " ");

  for (const block of blocks) {
    const titleEl = await block.$(".M7eMe");
    if (!titleEl) continue;
    const text = await titleEl.evaluate((el) => el.innerText?.trim().replace(/\s+/g, " "));
    if (text === needle) return block;
  }

  throw new Error(`[helpers] Question block not found for: "${question.title}"`);
}

// ---------------------------------------------------------------------------
// General Utilities
// ---------------------------------------------------------------------------

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}
