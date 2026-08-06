/**
 * Parsing of one job detail page.
 *
 * Kept apart from the Playwright navigation for the same reason
 * resume-selection.js is: the decision flow has to be testable against fixed
 * input, and a browser is not fixed input.
 */

import { parseWorkMode, parsePostedAt, findPostedLabel } from "./job-card.js";

/** Enough for the model to judge alignment without paying for a whole page of boilerplate. */
const MAX_DESCRIPTION_CHARS = 8000;

/**
 * @param {object} detail  { body_text, work_mode_label, posted_datetime, posted_label, apply_url_json }
 * @param {Date} now
 * @returns {{work_mode: string, posted_at: string|null, description: string, external_apply_url: string}}
 */
export function parseJobDetail(detail, now = new Date()) {
  const body = String(detail?.body_text || "").replace(/\s+/g, " ").trim();

  // The badge is the posting's own declaration; the body is the fallback. Both
  // beat the card, which is why enrichment exists.
  const workMode = detail?.work_mode_label
    ? parseWorkMode(detail.work_mode_label)
    : parseWorkMode(body);

  let externalApplyUrl = "";
  if (detail?.apply_url_json) {
    try {
      const parsed = JSON.parse(detail.apply_url_json);
      const candidate = parsed?.applyMethod?.companyApplyUrl || parsed?.companyApplyUrl || "";
      // Scraped from an untrusted page, so the scheme is checked rather than
      // assumed: this value ends up in an email the user is meant to click.
      if (/^https?:\/\//i.test(candidate)) externalApplyUrl = candidate;
    } catch {
      // A page whose embedded JSON changed shape is not a failure: the click
      // strategy is the fallback, and no URL at all is a valid answer.
    }
  }

  return {
    work_mode: workMode,
    posted_at: parsePostedAt(detail?.posted_datetime, detail?.posted_label || findPostedLabel(detail?.posted_candidates), now),
    description: body.slice(0, MAX_DESCRIPTION_CHARS),
    external_apply_url: externalApplyUrl
  };
}
