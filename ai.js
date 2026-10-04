/**
 * ai.js
 * AI-powered answer generation for Google Form questions.
 * Uses Google Gemini 2.0 Flash — best balance of cost and reasoning quality.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { FIELD_TYPES } from "./helpers.js";

// ---------------------------------------------------------------------------
// AI Client Setup  (gemini-2.0-flash — low cost, strong reasoning)
// ---------------------------------------------------------------------------

const MODEL_NAME = "gemini-2.5-flash";

/** Shared Gemini model instance — created once by initAI() */
let geminiModel = null;

/**
 * Initializes the Gemini client. Call this once at startup from index.js.
 * Reads GEMINI_API_KEY from the environment (loaded via dotenv in index.js).
 */
export function initAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("[ai] GEMINI_API_KEY is not set. Check your .env file.");

  const genAI = new GoogleGenerativeAI(apiKey);
  geminiModel = genAI.getGenerativeModel({ model: MODEL_NAME });
  console.log(`[ai] Gemini client initialized — model: ${MODEL_NAME}`);
}

// ---------------------------------------------------------------------------
// Core Answer Generation
// ---------------------------------------------------------------------------

export const TONES = [
  "casual and brief",
  "formal and precise",
  "friendly and enthusiastic",
  "neutral and direct",
  "slightly informal with natural phrasing",
  "imperfect grammar, very conversational",
];

export function getRandomTone() {
  return TONES[Math.floor(Math.random() * TONES.length)];
}

export const BEHAVIOR_PROFILES = [
  // 20% (1 in 5) - Top performer / High
  "Highly optimistic, highly competent, and eager. Tends to choose the most positive or highest-end options.",
  
  // 60% (3 in 5) - Average / Middle-of-the-road
  "Average and realistic. Sometimes struggles or faces challenges. Chooses middle-of-the-road or average options.",
  "Moderate performer. Doing okay but not great. Leans towards average or typical options rather than being perfect.",
  "Neutral and typical student. Not exceptionally good or bad, heavily tends to select the most common 'average' options.",
  
  // 20% (1 in 5) - Low / Struggling
  "Struggling or pessimistic. Often faces difficulties, lacks knowledge, or is disinterested. Frequently chooses lower-end, negative, or 'below average' options."
];

export function getRandomBehavior() {
  return BEHAVIOR_PROFILES[Math.floor(Math.random() * BEHAVIOR_PROFILES.length)];
}

/**
 * Master batch generator: given an array of questions, asks AI to return a JSON map of answers.
 *
 * @param {Array<Object>} questions - [{ title, type, options, required }]
 * @param {Object} context - { persona, previousAnswers, identity, formInfo, tone, behavior }
 * @returns {Promise<Object>} - A map of { "Question Title": "Answer" }
 */
export async function generatePageAnswers(questions, context = {}) {
  // If there are no AI-applicable questions (e.g., just dates), we could skip. But we'll just run them all.
  if (!questions || questions.length === 0) return {};

  const tone = context.tone || getRandomTone();
  const behavior = context.behavior || getRandomBehavior();

  let prompt = `You are an automated form filler acting as a specific persona. You must answer the following list of questions.\n`;
  prompt += `Tone/Style: ${tone}.\n`;
  prompt += `Behavior/Archetype: ${behavior}\n`;
  prompt += `CRITICAL: You must embody this behavior! If your behavior implies struggling or being average, you MUST purposely select lower-end options, negative options, or average options. Do NOT default to being a perfect or highly optimistic respondent unless your archetype explicitly demands it.\n\n`;

  if (context.formInfo && (context.formInfo.title || context.formInfo.desc)) {
    prompt += `Form Context: The user is filling out a form titled "${context.formInfo.title}".\n`;
    if (context.formInfo.desc) {
      prompt += `Form Description: "${context.formInfo.desc}"\n`;
    }
    prompt += `Use this context to inform your answers.\n\n`;
  }

  if (context.identity) {
    prompt += `Your Identity:\n- Name: ${context.identity.name}\n- Email: ${context.identity.email}\nIf a question asks for your name or email, use exactly these.\n\n`;
  }

  if (context.previousAnswers && Object.keys(context.previousAnswers).length > 0) {
    prompt += `Previous answers in this form (for consistency):\n`;
    for (const [q, a] of Object.entries(context.previousAnswers)) {
      prompt += `- ${q}: ${JSON.stringify(a)}\n`;
    }
    prompt += `\n`;
  }

  prompt += `Please generate answers for the following questions on the current page:\n`;
  
  questions.forEach((q, i) => {
    prompt += `${i + 1}. Title: "${q.title}"\n   Type: ${q.type}\n`;
    if (q.options && q.options.length > 0) {
      prompt += `   Options: ${JSON.stringify(q.options)}\n`;
    }
    if (q.type === FIELD_TYPES.SHORT_TEXT) {
      prompt += `   Constraint: 1 short sentence max.\n`;
    } else if (q.type === FIELD_TYPES.LONG_TEXT) {
      prompt += `   Constraint: 2-3 sentences max.\n`;
    } else if (q.type === FIELD_TYPES.LINEAR_SCALE) {
      prompt += `   Constraint: Pick a number between ${q.scaleMin || 1} and ${q.scaleMax || 5}.\n`;
    } else if (q.type === FIELD_TYPES.CHECKBOX) {
      prompt += `   Constraint: Select one or more options as an array of strings.\n`;
    }
  });

  prompt += `\nYou MUST respond with ONLY valid JSON and nothing else. No markdown blocks, no \`\`\`json. Just the raw JSON object. The object keys MUST be the exact question titles, and the values must be your answers.\n`;
  prompt += `Example output:\n{\n  "What is your name?": "Rahul Sharma",\n  "Which colors do you like?": ["Red", "Blue"]\n}\n`;

  const rawJsonStr = await callAI(prompt);

  try {
    // Attempt to parse. Often models wrap it in markdown anyway, so clean it.
    const cleaned = rawJsonStr.replace(/^```json/i, "").replace(/```$/, "").trim();
    const answers = JSON.parse(cleaned);
    return answers;
  } catch (err) {
    console.error("[ai] Failed to parse AI JSON response:", rawJsonStr);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// AI API Caller
// ---------------------------------------------------------------------------

/**
 * Sends a prompt to the configured AI client and returns the text response.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function callAI(prompt) {
  if (!geminiModel) throw new Error("[ai] AI client not initialized. Call initAI() first.");

  const result = await geminiModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8, // Slightly higher temp for more variation
    }
  });

  const metadata = result.response.usageMetadata;
  if (metadata) {
    const inputTokens = metadata.promptTokenCount || 0;
    const outputTokens = metadata.candidatesTokenCount || 0;
    // Gemini 2.5 Flash Pricing (per 1M tokens)
    const inputCostUSD = (inputTokens / 1000000) * 0.075;
    const outputCostUSD = (outputTokens / 1000000) * 0.30;
    const totalCostINR = (inputCostUSD + outputCostUSD) * 83.5;
    
    console.log(`[ai] Tokens: Input=${inputTokens}, Output=${outputTokens} | Cost: ₹${totalCostINR.toFixed(6)}`);
  }

  const text = result.response.text().trim();
  return text;
}

// ---------------------------------------------------------------------------
// Date / Time Generators (random, no AI needed)
// ---------------------------------------------------------------------------

/**
 * Generates a random past date (within 5 years) in YYYY-MM-DD format.
 * @returns {string}
 */
export function generateRandomDate() {
  const now = new Date();
  const pastMs = Math.floor(Math.random() * 5 * 365 * 24 * 60 * 60 * 1000);
  const date = new Date(now.getTime() - pastMs);
  return date.toISOString().split("T")[0];
}

/**
 * Generates a random time string in HH:MM format.
 * @returns {string}
 */
export function generateRandomTime() {
  const hours = String(Math.floor(Math.random() * 24)).padStart(2, "0");
  const minutes = String(Math.floor(Math.random() * 60)).padStart(2, "0");
  return `${hours}:${minutes}`;
}
