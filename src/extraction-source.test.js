import assert from "node:assert/strict";
import test from "node:test";
import { extractionChanged, hashResumeFile, hashResumeText } from "./extraction-source.js";

test("reflowed whitespace is not a new résumé", () => {
  const a = hashResumeText("Gabriel Santos\nBackend Engineer\n\n  Node.js");
  const b = hashResumeText("  Gabriel Santos   Backend Engineer Node.js  ");
  assert.equal(a, b, "so o conteudo conta, nao a formatacao");
});

test("a real edit produces a different hash", () => {
  assert.notEqual(hashResumeText("Backend Engineer"), hashResumeText("Backend Engineer, 8 anos"));
});

test("empty text has no hash, so the button is never armed by nothing", () => {
  assert.equal(hashResumeText(""), "");
  assert.equal(hashResumeText("   \n  "), "");
  assert.equal(hashResumeFile(Buffer.alloc(0)), "");
});

test("the first run is always offered", () => {
  assert.equal(extractionChanged(null, { source: "text", hash: "abc" }), true);
  assert.equal(extractionChanged({ hash: "" }, { source: "text", hash: "abc" }), true);
});

test("the same pasted text is not offered twice", () => {
  const last = { source: "text", hash: hashResumeText("Backend Engineer"), resume_id: null };
  assert.equal(extractionChanged(last, { source: "text", hash: hashResumeText("Backend Engineer") }), false);
  assert.equal(extractionChanged(last, { source: "text", hash: hashResumeText("Outro texto") }), true);
});

test("replacing the file re-arms the button even when the bytes match", () => {
  // Uploading again is a deliberate act; refusing to act on it would look broken.
  const content = Buffer.from("mesmo conteudo");
  const last = { source: "file", hash: hashResumeFile(content), resume_id: "r1" };
  assert.equal(extractionChanged(last, { source: "file", hash: hashResumeFile(content), resume_id: "r1" }), false);
  assert.equal(extractionChanged(last, { source: "file", hash: hashResumeFile(content), resume_id: "r2" }), true);
});

test("switching source always offers a new run", () => {
  const last = { source: "text", hash: hashResumeText("Backend"), resume_id: null };
  assert.equal(extractionChanged(last, { source: "file", hash: "outro", resume_id: "r1" }), true);
});

test("an edited file counts as a new source", () => {
  const last = { source: "file", hash: hashResumeFile(Buffer.from("v1")), resume_id: "r1" };
  assert.equal(extractionChanged(last, { source: "file", hash: hashResumeFile(Buffer.from("v2")), resume_id: "r1" }), true);
});
