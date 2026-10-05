/**
 * selectors.js
 * All CSS selectors for Google Forms, derived from actual DOM analysis.
 *
 * Google Form DOM key facts (from real form HTML):
 *  - Every question lives in [jsmodel="CP1oW"][data-params]
 *  - data-params encodes: [questionId, title, null, typeCode, [[entryId, options, required, ...]]]
 *  - typeCode: 0=SHORT_TEXT, 1=LONG_TEXT, 2=MULTIPLE_CHOICE, 3=DROPDOWN, 4=CHECKBOX, 5=LINEAR_SCALE, 9=DATE, 10=TIME
 *  - Options use [role="radio"] or [role="checkbox"] with a data-value attribute
 *  - Navigation: jsname="OCpkoe" (Next), jsname="M2UYVd" (Submit), jsname="GeGHKb" (Back)
 */

// ---------------------------------------------------------------------------
// Question structure
// ---------------------------------------------------------------------------

export const QUESTION_BLOCK      = '[jsmodel="CP1oW"][data-params]';
export const QUESTION_TITLE      = '.M7eMe';
export const SECTION_HEADER      = '.KkG9vf.mBzBBe';

// ---------------------------------------------------------------------------
// Radio / Multiple-Choice  (role="radio", type-code 2)
// ---------------------------------------------------------------------------

export const RADIO_GROUP         = '[role="radiogroup"]';
export const RADIO_OPTION        = '[role="radio"]';
/** Selector for a specific radio option by its exact label text */
export const radioByValue        = (value) => `[role="radio"][data-value="${CSS.escape(value)}"]`;
/** The visual dot/ripple that Puppeteer must click inside a radio element */
export const RADIO_CLICK_TARGET  = 'div.vd3tt';

// ---------------------------------------------------------------------------
// Checkbox  (role="checkbox", type-code 4)
// NOTE: Checkboxes use data-answer-value, NOT data-value (unlike radio buttons)
// ---------------------------------------------------------------------------

export const CHECKBOX_OPTION       = '[role="checkbox"]';
export const checkboxByAnswerValue = (value) => `[role="checkbox"][data-answer-value="${value}"]`;
/** The visual box element that must be clicked inside a checkbox element */
export const CHECKBOX_CLICK_TARGET = 'div.uHMk6b';

// ---------------------------------------------------------------------------
// Short / Long text  (type-code 0 / 1)
// ---------------------------------------------------------------------------

/** Single-line text input (Short Answer) */
export const SHORT_TEXT_INPUT    = 'input.whsOnd[type="text"], input.whsOnd[type="email"], input.whsOnd[type="url"], input.whsOnd[type="number"]';
/** Multi-line textarea (Paragraph) */
export const LONG_TEXT_INPUT     = 'textarea.KHxj8b';

// ---------------------------------------------------------------------------
// Dropdown  (type-code 3)
// ---------------------------------------------------------------------------

export const DROPDOWN_TRIGGER    = '[role="listbox"]';
export const DROPDOWN_OPTION     = '[role="option"]';
export const dropdownByValue     = (value) => `[role="option"][data-value="${CSS.escape(value)}"]`;

// ---------------------------------------------------------------------------
// Linear Scale  (type-code 5)
// ---------------------------------------------------------------------------

/** Each point on a linear scale is a radio with a numeric data-value */
export const LINEAR_SCALE_POINT  = '[role="radio"][data-value]';
export const scaleByValue        = (value) => `[role="radio"][data-value="${value}"]`;

// ---------------------------------------------------------------------------
// Date / Time  (type-code 9 / 10)
// ---------------------------------------------------------------------------

export const DATE_INPUT          = 'input[type="date"]';
export const DATE_YEAR_INPUT     = 'input[aria-label="Year"]';
export const DATE_MONTH_INPUT    = 'input[aria-label="Month"]';
export const DATE_DAY_INPUT      = 'input[aria-label="Day"]';
export const TIME_HOUR_INPUT     = 'input[aria-label="Hour"]';
export const TIME_MINUTE_INPUT   = 'input[aria-label="Minute"]';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** "Next" button (all pages except the last) */
export const NEXT_BUTTON         = '[jsname="OCpkoe"]';
/** "Submit" button (last page only) */
export const SUBMIT_BUTTON       = '[jsname="M2UYVd"]';
/** "Back" button */
export const BACK_BUTTON         = '[jsname="GeGHKb"]';
/** "Clear form" button */
export const CLEAR_BUTTON        = '[jsname="X5DuWc"]';

// ---------------------------------------------------------------------------
// Post-submission
// ---------------------------------------------------------------------------

/** Confirmation text shown after successful submit */
export const CONFIRMATION_MSG    = '.vHW8K';
/** "Submit another response" link */
export const SUBMIT_ANOTHER_LINK = '.c2gzEf a';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Input element that stores pageHistory (e.g. "0,1,2") */
export const PAGE_HISTORY_INPUT  = 'input[name="pageHistory"]';
