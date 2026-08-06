import assert from "node:assert/strict";
import test from "node:test";
import {
  SEND_STATES,
  buildRecordId,
  isSendable,
  normalizeDmRecord,
  normalizeInviteRecord,
  normalizeJobRecord
} from "./agent-record.js";

const easyApplyJob = {
  search_name: "ai_engineer_easy_apply",
  external_id: "4448531848",
  url: "https://www.linkedin.com/jobs/view/4448531848/",
  apply_url: "https://www.linkedin.com/jobs/view/4448531848/apply/",
  title: "Senior Software Engineer (AI/Agentic)",
  company: "ProSearch",
  location: "Remote",
  easy_apply: true,
  sponsored: false,
  applied: false,
  compact_text: "Senior AI engineer, remote"
};

test("record ids are stable and unique per pipeline/kind/id", () => {
  assert.equal(buildRecordId("jobs", "job", "1"), buildRecordId("jobs", "job", "1"));
  assert.notEqual(buildRecordId("jobs", "job", "1"), buildRecordId("dm", "job", "1"));
  assert.notEqual(buildRecordId("jobs", "job", "1"), buildRecordId("jobs", "job", "2"));
});

test("every pipeline produces the same record shape", () => {
  const job = normalizeJobRecord(easyApplyJob, null, { score: 80 });
  const dm = normalizeDmRecord({ thread_id: "t1", participant: "Ana", url: "https://x" }, null, {});
  const invite = normalizeInviteRecord({ invitation_id: "i1", name: "Bruno" }, {});

  const keys = Object.keys(job).sort();
  assert.deepEqual(Object.keys(dm).sort(), keys);
  assert.deepEqual(Object.keys(invite).sort(), keys);
  for (const record of [job, dm, invite]) {
    assert.ok(SEND_STATES.includes(record.send_state), `${record.pipeline}: ${record.send_state}`);
    assert.equal(typeof record.title, "string");
    assert.ok(Array.isArray(record.risk_flags));
  }
});

test("an unevaluated Easy Apply job is available for manual send", () => {
  const record = normalizeJobRecord(easyApplyJob, null, { score: 88 });
  assert.equal(record.send_method, "easy_apply");
  assert.equal(record.send_state, "available");
  assert.equal(record.status, "analyzed");
  assert.equal(record.score, 88);
  assert.equal(isSendable(record), true);
});

test("a job without Easy Apply has no automatic send method", () => {
  const record = normalizeJobRecord({ ...easyApplyJob, easy_apply: false }, null, {});
  assert.equal(record.send_method, "external");
  assert.equal(record.send_state, "unsupported");
  assert.equal(isSendable(record), false);
  assert.match(record.send_blocked_reason, /site da empresa/i);
});

test("a job already applied on LinkedIn is marked as sent by automation", () => {
  const record = normalizeJobRecord({ ...easyApplyJob, applied: true }, null, {});
  assert.equal(record.send_state, "sent_auto");
  assert.equal(record.status, "sent");
  assert.equal(isSendable(record), false);
});

test("a model rejection blocks the send and carries the reason", () => {
  const record = normalizeJobRecord(easyApplyJob, {
    apply: false,
    confidence: 30,
    risk_flags: ["stack_mismatch"],
    reason: "Stack antiga e pouca aderencia."
  }, {});
  assert.equal(record.decision, "reject");
  assert.equal(record.send_state, "blocked");
  assert.equal(isSendable(record), false);
  assert.match(record.send_blocked_reason, /Stack antiga/);
  assert.deepEqual(record.risk_flags, ["stack_mismatch"]);
});

test("an approved evaluation keeps the job sendable and records confidence", () => {
  const record = normalizeJobRecord(easyApplyJob, {
    apply: true,
    resume_type: "ai_engineer",
    confidence: 85,
    risk_flags: [],
    reason: "Boa aderencia."
  }, { score: 90 });
  assert.equal(record.decision, "apply");
  assert.equal(record.send_state, "available");
  assert.equal(record.confidence, 85);
  assert.equal(record.variant, "ai_engineer");
});

test("sponsored jobs always surface a risk flag", () => {
  const record = normalizeJobRecord({ ...easyApplyJob, sponsored: true }, null, {});
  assert.ok(record.risk_flags.includes("sponsored"));
});

test("explicit context overrides win over inferred state", () => {
  const record = normalizeJobRecord(easyApplyJob, null, {
    sendState: "sent_manual",
    sentAt: "2026-08-05T10:00:00.000Z",
    sentBy: "manual"
  });
  assert.equal(record.send_state, "sent_manual");
  assert.equal(record.status, "sent");
  assert.equal(record.sent_by, "manual");
});

test("scores and confidence are clamped to 0-100 integers", () => {
  const record = normalizeJobRecord(easyApplyJob, { apply: true, confidence: 250 }, { score: -20 });
  assert.equal(record.score, 0);
  assert.equal(record.confidence, 100);
});

test("dm records are sendable only when a draft was approved", () => {
  const approved = normalizeDmRecord({ thread_id: "t1", participant: "Ana" }, { action: "reply", draft: "oi" }, {});
  assert.equal(approved.send_state, "available");
  assert.equal(approved.send_method, "dm_reply");

  const noDraft = normalizeDmRecord({ thread_id: "t2", participant: "Bruno" }, null, {});
  assert.equal(noDraft.send_state, "blocked");
  assert.equal(isSendable(noDraft), false);

  const sent = normalizeDmRecord({ thread_id: "t3", participant: "Caio" }, { draft: "oi" }, {
    sentAt: "2026-08-05T10:00:00.000Z"
  });
  assert.equal(sent.send_state, "sent_auto");
  assert.equal(sent.sent_by, "auto");
});

test("accepted invites are recorded as sent", () => {
  const record = normalizeInviteRecord({ invitation_id: "i1", name: "Duda" }, { accepted: true, sentAt: "2026-08-05T10:00:00.000Z" });
  assert.equal(record.kind, "invite");
  assert.equal(record.send_state, "sent_auto");
  assert.equal(record.decision, "accept");
});

test("raw payload keeps the original job for the manual send flow", () => {
  const record = normalizeJobRecord(easyApplyJob, null, {});
  assert.equal(record.raw.job.external_id, easyApplyJob.external_id);
  assert.equal(record.raw.job.easy_apply, true);
  assert.equal(record.raw.job.apply_url, easyApplyJob.apply_url);
});

test("o registro de vaga carrega modalidade, data e a camada que decidiu", () => {
  const record = normalizeJobRecord(
    {
      external_id: "77",
      title: "Backend",
      company: "Acme",
      url: "https://www.linkedin.com/jobs/view/77/",
      easy_apply: true,
      work_mode: "remote",
      posted_at: "2026-08-05T12:00:00.000Z"
    },
    null,
    { filterStage: "prefilter", blockedUntil: "2026-08-09T12:00:00.000Z" }
  );

  assert.equal(record.work_mode, "remote");
  assert.equal(record.posted_at, "2026-08-05T12:00:00.000Z");
  assert.equal(record.filter_stage, "prefilter");
  assert.equal(record.blocked_until, "2026-08-09T12:00:00.000Z");
  assert.equal(record.digested_at, null);
});

test("modalidade ausente vira unknown em vez de string vazia", () => {
  const record = normalizeJobRecord({ external_id: "78", title: "x", easy_apply: false }, null, {});
  assert.equal(record.work_mode, "unknown");
  assert.equal(record.posted_at, null);
});
