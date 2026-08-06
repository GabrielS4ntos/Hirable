import test from "node:test";
import assert from "node:assert/strict";
import { prefilterJob, FILTER_STAGES } from "./job-prefilter.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");

function baseJob(overrides = {}) {
  return {
    external_id: "1",
    title: "Senior Backend Engineer",
    company: "Acme",
    work_mode: "remote",
    posted_at: "2026-08-05T12:00:00.000Z",
    easy_apply: true,
    applied: false,
    apply_url: "https://www.linkedin.com/jobs/view/1/apply/",
    ...overrides
  };
}

function baseContext(overrides = {}) {
  return {
    config: {
      jobs_watcher: {
        easy_apply_enabled: true,
        read_only: false,
        freshness_days: 7,
        blocked_companies: [],
        blocked_apply_domains: []
      }
    },
    profile: { work_eligibility: { remote_only: true } },
    state: { jobs: { applications: {} } },
    quarantine: new Map(),
    now: NOW,
    ...overrides
  };
}

const CARD = { phase: "card" };
const ENRICHED = { phase: "enriched" };

test("a fresh remote job passes both phases", () => {
  assert.equal(prefilterJob(baseJob(), baseContext(), CARD).pass, true);
  assert.equal(prefilterJob(baseJob(), baseContext(), ENRICHED).pass, true);
});

test("easy_apply_enabled=false blocks instead of allowing", () => {
  // The previous implementation returned "no hard block" here, so turning Easy
  // Apply off made the pipeline apply. This test exists to keep that from
  // coming back.
  const context = baseContext();
  context.config.jobs_watcher.easy_apply_enabled = false;
  const result = prefilterJob(baseJob(), context, ENRICHED);
  assert.equal(result.pass, false);
  assert.equal(result.code, "easy_apply_disabled");
});

test("read_only blocks instead of allowing", () => {
  const context = baseContext();
  context.config.jobs_watcher.read_only = true;
  const result = prefilterJob(baseJob(), context, ENRICHED);
  assert.equal(result.pass, false);
  assert.equal(result.code, "read_only");
});

test("unknown work mode promotes on the card and rejects once enriched", () => {
  const job = baseJob({ work_mode: "unknown" });
  assert.equal(prefilterJob(job, baseContext(), CARD).pass, true);

  const enriched = prefilterJob(job, baseContext(), ENRICHED);
  assert.equal(enriched.pass, false);
  assert.equal(enriched.code, "work_mode_unknown");
});

test("hybrid and on-site are rejected in both phases for a remote-only profile", () => {
  for (const mode of ["hybrid", "onsite"]) {
    const job = baseJob({ work_mode: mode });
    assert.equal(prefilterJob(job, baseContext(), CARD).pass, false, mode);
    assert.equal(prefilterJob(job, baseContext(), CARD).code, "work_mode_not_remote");
  }
});

test("work mode is not filtered when the profile is not remote-only", () => {
  const context = baseContext({ profile: { work_eligibility: { remote_only: false } } });
  assert.equal(prefilterJob(baseJob({ work_mode: "onsite" }), context, ENRICHED).pass, true);
  assert.equal(prefilterJob(baseJob({ work_mode: "unknown" }), context, ENRICHED).pass, true);
});

test("a job older than the horizon is rejected", () => {
  const job = baseJob({ posted_at: "2026-07-01T12:00:00.000Z" });
  const result = prefilterJob(job, baseContext(), CARD);
  assert.equal(result.pass, false);
  assert.equal(result.code, "too_old");
});

test("unknown posting date promotes on the card and rejects once enriched", () => {
  const job = baseJob({ posted_at: null });
  assert.equal(prefilterJob(job, baseContext(), CARD).pass, true);
  assert.equal(prefilterJob(job, baseContext(), ENRICHED).code, "posted_at_unknown");
});

test("blocked company is rejected on the card, before any enrichment cost", () => {
  const context = baseContext();
  context.config.jobs_watcher.blocked_companies = ["micro1"];
  const result = prefilterJob(baseJob({ company: "Micro1 Inc" }), context, CARD);
  assert.equal(result.pass, false);
  assert.equal(result.code, "blocked_company");
  assert.equal(result.stage, FILTER_STAGES.PREFILTER);
});

test("blocked apply domain is only evaluated once enriched", () => {
  const context = baseContext();
  context.config.jobs_watcher.blocked_apply_domains = ["micro1.ai"];
  const job = baseJob({ easy_apply: false, external_apply_url: "https://jobs.micro1.ai/9" });

  assert.equal(prefilterJob(job, context, CARD).pass, true);
  const enriched = prefilterJob(job, context, ENRICHED);
  assert.equal(enriched.pass, false);
  assert.equal(enriched.code, "blocked_apply_domain");
});

test("a job already applied to is rejected", () => {
  assert.equal(prefilterJob(baseJob({ applied: true }), baseContext(), CARD).code, "already_applied");

  const context = baseContext();
  context.state.jobs.applications["1"] = { applied_at: NOW.toISOString() };
  assert.equal(prefilterJob(baseJob(), context, CARD).code, "already_applied");
});

test("quarantine blocks until it expires, then stops blocking", () => {
  const context = baseContext();
  context.quarantine.set("1", "2026-08-06T18:00:00.000Z");
  const blocked = prefilterJob(baseJob(), context, CARD);
  assert.equal(blocked.pass, false);
  assert.equal(blocked.code, "quarantined");

  context.quarantine.set("1", "2026-08-06T06:00:00.000Z");
  assert.equal(prefilterJob(baseJob(), context, CARD).pass, true);
});

test("a job without Easy Apply survives the prefilter so the digest can carry it", () => {
  const job = baseJob({ easy_apply: false });
  assert.equal(prefilterJob(job, baseContext(), CARD).pass, true);
  assert.equal(prefilterJob(job, baseContext(), ENRICHED).pass, true);
});

test("a job without Easy Apply is not blocked by the send settings", () => {
  // Those settings disarm sending, and this job was never going to be sent.
  const context = baseContext();
  context.config.jobs_watcher.easy_apply_enabled = false;
  context.config.jobs_watcher.read_only = true;
  assert.equal(prefilterJob(baseJob({ easy_apply: false }), context, ENRICHED).pass, true);
});

test("every rejection carries a human-readable reason", () => {
  const context = baseContext();
  context.config.jobs_watcher.blocked_companies = ["micro1"];
  const result = prefilterJob(baseJob({ company: "Micro1" }), context, CARD);
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason.length > 0);
});

test("the company block list ignores accents and case", () => {
  const context = baseContext();
  context.config.jobs_watcher.blocked_companies = ["ACME Tecnologia"];
  const result = prefilterJob(baseJob({ company: "Acme Tecnología Ltda" }), context, CARD);
  assert.equal(result.code, "blocked_company");
});
