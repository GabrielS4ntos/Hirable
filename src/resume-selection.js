import { findResumeEntry, resumeNameMatches } from "./resume-upload.js";

/**
 * The résumé step of the Easy Apply form.
 *
 * Separated from the pipeline so the decision flow — expand, look, select or
 * upload, verify — can be exercised against a fake page. The Playwright calls
 * used here are deliberately few and boring (`getByRole`, `click`,
 * `setInputFiles`) so a stand-in is a faithful stand-in.
 */

/** Opens every "+N currículos" / "Mostrar mais" control so the whole list is readable. */
export async function expandResumeList(page) {
  const patterns = [
    /\+\d+\s+(currículos?|curriculos?|resumes?)/i,
    /(mostrar|ver|show)\s+(mais|todos|all|more)/i
  ];
  let expanded = 0;
  for (const pattern of patterns) {
    const buttons = await page.getByRole("button", { name: pattern }).all().catch(() => []);
    for (const button of buttons) {
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      expanded += 1;
    }
  }
  return expanded;
}

/**
 * Text of each résumé card in the expanded list.
 *
 * Read from the selection controls rather than from the page text, because the
 * accessible name of a "Selecionar resume X" button is the one place where the
 * entry's identity is unambiguous.
 */
export async function readResumeEntries(page) {
  const entries = [];
  const controls = await page
    .getByRole("button", { name: /(selecionar|desmarcar seleção de|select|unselect)\s+resume/i })
    .all()
    .catch(() => []);

  for (const control of controls) {
    const name = await control.getAttribute("aria-label").catch(() => null)
      || await control.innerText().catch(() => "");
    const text = String(name).replace(/^(selecionar|desmarcar seleção de|select|unselect)\s+resume\s*/i, "").trim();
    if (text) entries.push({ text, control, selected: /desmarcar|unselect/i.test(String(name)) });
  }
  return entries;
}

/**
 * Puts the chosen résumé on the application.
 *
 * Order matters: the list is expanded and searched first, and the file is
 * uploaded only when the document genuinely is not there. Uploading on every
 * application would pile duplicates into an account-wide list that LinkedIn
 * caps, so the upload is a first-use bootstrap, not a routine step.
 *
 * Selection is verified afterwards. A résumé believed to be selected but not
 * actually marked is the one failure mode that silently sends the wrong
 * document, so it is reported as unconfirmed instead of assumed.
 */
export async function ensureResumeSelected(page, { displayName, filePath = null, uploadEnabled = true }) {
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const resumeSectionVisible = /resume|currículo|curriculo/i.test(body);
  if (!resumeSectionVisible) {
    return { ok: true, confirmed: false, reason: "resume_not_visible_yet", resume_display_name: displayName };
  }

  const expandedCount = await expandResumeList(page);
  const entries = await readResumeEntries(page);
  const match = findResumeEntry(entries.map((entry) => entry.text), displayName);

  if (match) {
    const entry = entries[match.index];
    if (entry.selected) {
      return { ok: true, confirmed: true, already_selected: true, matched_text: entry.text, resume_display_name: displayName, expanded_count: expandedCount };
    }
    await entry.control.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    const verified = await verifyResumeSelected(page, displayName);
    return {
      ok: verified,
      confirmed: verified,
      selected_now: true,
      matched_text: entry.text,
      reason: verified ? null : "selection_not_confirmed_after_click",
      resume_display_name: displayName,
      expanded_count: expandedCount
    };
  }

  if (!uploadEnabled || !filePath) {
    return {
      ok: false,
      confirmed: false,
      reason: "resume_not_found_and_upload_unavailable",
      resume_display_name: displayName,
      available_entries: entries.map((entry) => entry.text).slice(0, 10)
    };
  }

  const uploaded = await uploadResumeFile(page, filePath);
  if (!uploaded.ok) {
    return { ok: false, confirmed: false, reason: uploaded.reason, resume_display_name: displayName, available_entries: entries.map((entry) => entry.text).slice(0, 10) };
  }

  // LinkedIn selects a freshly uploaded résumé on its own, but that is its
  // behaviour and not a promise, so it is verified like any other selection.
  const verified = await verifyResumeSelected(page, displayName);
  return {
    ok: verified,
    confirmed: verified,
    uploaded: true,
    reason: verified ? null : "upload_done_but_selection_not_confirmed",
    resume_display_name: displayName,
    expanded_count: expandedCount
  };
}

/** Sets the file on the hidden input; no native dialog is ever opened. */
export async function uploadResumeFile(page, filePath) {
  const input = page.locator('input[type="file"]').first();
  if (!(await input.count().catch(() => 0))) {
    return { ok: false, reason: "file_input_not_found" };
  }
  try {
    await input.setInputFiles(filePath, { timeout: 10000 });
  } catch (error) {
    return { ok: false, reason: `upload_failed: ${String(error.message || error).slice(0, 200)}` };
  }
  // The card only appears once LinkedIn has accepted the file.
  await page.waitForTimeout(2500);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  return { ok: true, reason: null };
}

/** True only when the intended résumé is the one actually marked as selected. */
export async function verifyResumeSelected(page, displayName) {
  const entries = await readResumeEntries(page);
  const selected = entries.filter((entry) => entry.selected);
  if (!selected.length) return false;
  return selected.some((entry) => resumeNameMatches(entry.text, displayName));
}