import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SemanticMemory,
  bufferToVector,
  buildSemanticFieldText,
  cosineSimilarity,
  selectSemanticMatch,
  vectorToBuffer
} from "./semantic-memory.js";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-semantic-memory-"));
const databasePath = path.join(tempDirectory, "memory.sqlite");
const memory = new SemanticMemory(databasePath);

try {
  assert.equal(buildSemanticFieldText({ label: "<b>Current city</b>", kind: "text" }).includes("<b>"), false);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(vectorToBuffer([1, Number.NaN]), null);
  assert.equal(bufferToVector(Buffer.alloc(3), 2), null);

  const approvedId = memory.upsert({
    label: "Current city",
    kind: "text",
    answer: "Example City",
    vector: [1, 0, 0],
    embeddingModel: "mock-embedding",
    status: "approved",
    source: "deterministic"
  });
  memory.upsert({
    label: "Expected salary",
    kind: "text",
    answer: "4500",
    vector: [0, 1, 0],
    embeddingModel: "mock-embedding",
    status: "pending",
    source: "ai_form_filler"
  });
  assert.equal(memory.findExact({ label: "Current city", kind: "text" }).answer, "Example City");
  assert.equal(memory.findExact({ label: "Expected salary", kind: "text" }), null);

  const matches = memory.search({ label: "City of residence", kind: "text", options: [] }, [0.99, 0.01, 0], "mock-embedding", 3);
  assert.equal(matches[0].id, approvedId);
  assert.ok(matches[0].similarity > 0.99);
  assert.equal(selectSemanticMatch(matches, {}).auto.answer, "Example City");

  const ambiguous = selectSemanticMatch([
    { id: "a", answer: "Yes", similarity: 0.95 },
    { id: "b", answer: "No", similarity: 0.93 }
  ], { minimum_score_margin: 0.05 });
  assert.equal(ambiguous.auto, null);
  assert.equal(ambiguous.reason, "ambiguous");

  const pendingId = memory.upsert({ label: "Years of Python", kind: "text", answer: "6", status: "pending", source: "ai_form_filler" });
  assert.equal(memory.findExact({ label: "Years of Python", kind: "text" }), null);
  assert.equal(memory.approve([pendingId]), 1);
  assert.equal(memory.findExact({ label: "Years of Python", kind: "text" }).answer, "6");
  memory.markUsed(approvedId);
  assert.equal(Number(memory.stats().approved), 2);

  console.log(JSON.stringify({ status: "ok", tests: 16, stats: memory.stats() }, null, 2));
} finally {
  memory.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
