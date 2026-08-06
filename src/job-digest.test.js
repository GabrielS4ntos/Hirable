import test from "node:test";
import assert from "node:assert/strict";
import { selectDigestJobs } from "./job-digest.js";
import { renderJobDigestEmail } from "./email-template.js";

function job(overrides) {
  return { external_id: "1", title: "Backend", company: "Acme", url: "https://x", easy_apply: true, ...overrides };
}

test("a job without Easy Apply is actionable", () => {
  const entries = selectDigestJobs([job({ easy_apply: false, external_apply_url: "https://acme.com/apply" })]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].category, "no_easy_apply");
});

test("a job cut by the run cap reaches the user instead of vanishing", () => {
  const entries = selectDigestJobs([job({ filter_outcome: { code: "over_run_cap", stage: "cap" } })]);
  assert.equal(entries[0].category, "over_cap");
});

test("the daily and weekly caps are treated the same way", () => {
  for (const code of ["over_daily_cap", "over_weekly_cap"]) {
    const entries = selectDigestJobs([job({ filter_outcome: { code, stage: "cap" } })]);
    assert.equal(entries[0].category, "over_cap", code);
  }
});

test("a quarantined job is actionable", () => {
  const entries = selectDigestJobs([job({ blocked_until: "2099-01-01T00:00:00.000Z" })]);
  assert.equal(entries[0].category, "quarantined");
});

test("an expired quarantine is not actionable", () => {
  assert.deepEqual(selectDigestJobs([job({ blocked_until: "2000-01-01T00:00:00.000Z" })]), []);
});

test("a job whose posting could not be read is actionable", () => {
  const entries = selectDigestJobs([job({ filter_outcome: { code: "enrichment_failed", stage: "enrichment" } })]);
  assert.equal(entries[0].category, "enrichment_failed");
});

test("a decision is not a pending item and stays out of the email", () => {
  const decisions = [
    job({ external_id: "a", filter_outcome: { code: "blocked_company", stage: "prefilter" } }),
    job({ external_id: "b", filter_outcome: { code: "work_mode_not_remote", stage: "prefilter" } }),
    job({ external_id: "c", filter_outcome: { code: "model_rejected", stage: "model" } }),
    job({ external_id: "d", filter_outcome: { code: "not_eligible", stage: "eligibility" } })
  ];
  assert.deepEqual(selectDigestJobs(decisions), []);
});

test("an already sent job is not in the digest", () => {
  assert.deepEqual(selectDigestJobs([job({ applied: true })]), []);
});

test("a job already digested is not repeated", () => {
  assert.deepEqual(selectDigestJobs([job({ easy_apply: false, digested_at: "2026-08-05T00:00:00.000Z" })]), []);
});

test("a job appearing in two lists is listed once, richest copy first", () => {
  const card = job({ easy_apply: false, external_apply_url: "" });
  const enriched = job({ easy_apply: false, external_apply_url: "https://acme.com/apply" });
  const entries = selectDigestJobs([enriched, card]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].job.external_apply_url, "https://acme.com/apply");
});

test("the rendered email carries the direct apply link and escapes the title", () => {
  const rendered = renderJobDigestEmail({
    entries: [{
      job: job({ easy_apply: false, title: "Dev <script>", external_apply_url: "https://acme.com/apply" }),
      category: "no_easy_apply",
      reason: "Sem candidatura simplificada."
    }],
    consoleUrl: "http://127.0.0.1:4321"
  });

  assert.match(rendered.text, /https:\/\/acme\.com\/apply/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
});

test("the email groups by reason so the user reads why each job arrived", () => {
  const rendered = renderJobDigestEmail({
    entries: [
      { job: job({ external_id: "1", easy_apply: false }), category: "no_easy_apply", reason: "r1" },
      { job: job({ external_id: "2" }), category: "over_cap", reason: "r2" }
    ]
  });
  assert.match(rendered.text, /Candidatura no site da empresa \(1\)/);
  assert.match(rendered.text, /Não coube nesta execução \(1\)/);
  assert.match(rendered.subject, /2 vaga\(s\)/);
});

test("an empty digest renders nothing to send", () => {
  assert.equal(renderJobDigestEmail({ entries: [] }), null);
});
