import assert from "node:assert/strict";
import test from "node:test";
import { RESUME_GATE_CODE, evaluateResumeGate, resumeGateError } from "./resume-gate.js";
import {
  MAX_UPLOAD_BYTES,
  canUploadResume,
  findResumeEntry,
  normalizeResumeName,
  resumeNameMatches,
  stripExtension
} from "./resume-upload.js";

/* -------------------------------------------------------------------- gate */

test("an empty résumé library closes the gate", () => {
  const gate = evaluateResumeGate([]);
  assert.equal(gate.ready, false);
  assert.equal(gate.code, RESUME_GATE_CODE);
  assert.equal(gate.count, 0);
  assert.match(gate.reason, /currículo/i);
  assert.equal(resumeGateError(gate).code, RESUME_GATE_CODE);
});

test("a single stored résumé is enough to open it", () => {
  const gate = evaluateResumeGate([{ id: "r1" }]);
  assert.equal(gate.ready, true);
  assert.equal(gate.code, null);
  assert.equal(gate.count, 1);
});

/* ---------------------------------------------------------------- matching */

test("the same file survives a different separator, case and accent", () => {
  assert.equal(normalizeResumeName("Currículo Gabriel-Santos (1).pdf"), "curriculogabrielsantos1");
  assert.equal(resumeNameMatches("Curriculo_Gabriel_Santos_1.pdf", "Currículo Gabriel-Santos (1).pdf"), true);
});

test("the extension is not part of the identity", () => {
  assert.equal(stripExtension("cv.docx"), "cv");
  assert.equal(resumeNameMatches("Gabriel Santos CV", "Gabriel Santos CV.pdf"), true);
});

test("a name truncated by LinkedIn still matches ours", () => {
  assert.equal(
    resumeNameMatches("Gabriel_Santos_Curriculo_Backend…", "Gabriel_Santos_Curriculo_Backend_2026.pdf"),
    true
  );
  assert.equal(
    resumeNameMatches("Gabriel_Santos_Curriculo...", "Gabriel_Santos_Curriculo_Backend_2026.pdf"),
    true
  );
});

test("a short prefix never stands in for a longer name", () => {
  // The failure this prevents: submitting a 2019 résumé because both start "CV".
  assert.equal(resumeNameMatches("CV…", "CV_antigo_2019.pdf"), false);
  assert.equal(resumeNameMatches("CV", "CV_antigo_2019.pdf"), false);
});

test("truncation is only accepted in the direction LinkedIn truncates", () => {
  // Ours is the short one: that is a different document, not a cut-off name.
  assert.equal(resumeNameMatches("Curriculo_Gabriel_Santos_Backend_2026.pdf", "Curriculo_Gabriel…"), false);
});

test("two different résumés are never confused", () => {
  assert.equal(resumeNameMatches("Curriculo_Backend_2026.pdf", "Curriculo_Frontend_2026.pdf"), false);
  assert.equal(resumeNameMatches("", "Curriculo.pdf"), false);
  assert.equal(resumeNameMatches("Curriculo.pdf", ""), false);
});

test("the entry is found by position in the expanded list", () => {
  const entries = ["CV_antigo_2019.pdf", "Curriculo_Backend_2026.pdf", "Outro.pdf"];
  const found = findResumeEntry(entries, "Curriculo_Backend_2026.pdf");
  assert.equal(found.index, 1);
  assert.equal(findResumeEntry(entries, "Nao_Existe.pdf"), null);
  assert.equal(findResumeEntry([], "qualquer.pdf"), null);
});

/* ------------------------------------------------------------ upload rules */

test("only the formats LinkedIn accepts can be uploaded", () => {
  for (const name of ["cv.pdf", "cv.doc", "cv.docx", "CV.PDF"]) {
    assert.equal(canUploadResume({ original_name: name }, 1000).ok, true, name);
  }
  const rejected = canUploadResume({ original_name: "cv.txt" }, 1000);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "extensao_nao_aceita_pelo_linkedin");
  assert.equal(canUploadResume({ original_name: "cv.rtf" }, 1000).ok, false);
  assert.equal(canUploadResume({ original_name: "curriculo" }, 1000).ok, false);
});

test("a file above the size limit is refused before the application starts", () => {
  assert.equal(canUploadResume({ original_name: "cv.pdf" }, MAX_UPLOAD_BYTES).ok, true);
  const tooBig = canUploadResume({ original_name: "cv.pdf" }, MAX_UPLOAD_BYTES + 1);
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.reason, "arquivo_acima_de_2mb");
});
