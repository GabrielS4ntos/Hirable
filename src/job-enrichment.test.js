import test from "node:test";
import assert from "node:assert/strict";
import { parseJobDetail } from "./job-enrichment.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");

test("the posting's own badge wins over the card's guess", () => {
  const detail = parseJobDetail({
    body_text: "Vaga híbrida em São Paulo. Comparecer 2x por semana.",
    work_mode_label: "Híbrido",
    posted_datetime: "2026-08-04T10:00:00.000Z",
    posted_label: "",
    apply_url_json: ""
  }, NOW);

  assert.equal(detail.work_mode, "hybrid");
  assert.equal(detail.posted_at, "2026-08-04T10:00:00.000Z");
});

test("falls back to the body text when there is no badge", () => {
  const detail = parseJobDetail({
    body_text: "Trabalho 100% remoto, horário flexível.",
    work_mode_label: "",
    posted_datetime: "",
    posted_label: "há 1 dia",
    apply_url_json: ""
  }, NOW);

  assert.equal(detail.work_mode, "remote");
  assert.equal(detail.posted_at, "2026-08-05T12:00:00.000Z");
});

test("extracts the external apply URL from the embedded JSON", () => {
  const detail = parseJobDetail({
    body_text: "Candidate-se pelo nosso site.",
    work_mode_label: "Remoto",
    posted_datetime: "",
    posted_label: "há 1 dia",
    apply_url_json: '{"applyMethod":{"companyApplyUrl":"https://jobs.micro1.ai/9?src=li"}}'
  }, NOW);

  assert.equal(detail.external_apply_url, "https://jobs.micro1.ai/9?src=li");
});

test("malformed embedded JSON yields no URL instead of throwing", () => {
  const detail = parseJobDetail({
    body_text: "x", work_mode_label: "Remoto", posted_datetime: "", posted_label: "há 1 dia",
    apply_url_json: "{not json"
  }, NOW);
  assert.equal(detail.external_apply_url, "");
});

test("a non-http destination is refused", () => {
  // The value comes from a scraped page, so it is untrusted input.
  const detail = parseJobDetail({
    body_text: "x", work_mode_label: "Remoto", posted_datetime: "", posted_label: "há 1 dia",
    apply_url_json: '{"applyMethod":{"companyApplyUrl":"javascript:alert(1)"}}'
  }, NOW);
  assert.equal(detail.external_apply_url, "");
});

test("the description is trimmed but keeps enough for the model to judge", () => {
  const long = "a".repeat(20000);
  const detail = parseJobDetail({
    body_text: long, work_mode_label: "Remoto", posted_datetime: "", posted_label: "há 1 dia", apply_url_json: ""
  }, NOW);

  assert.equal(detail.description.length, 8000);
});

test("an empty detail yields unknowns rather than throwing", () => {
  const detail = parseJobDetail({}, NOW);
  assert.equal(detail.work_mode, "unknown");
  assert.equal(detail.posted_at, null);
  assert.equal(detail.description, "");
  assert.equal(detail.external_apply_url, "");
});

test("takes the posting date from the page's phrases when there is no <time>", () => {
  // The detail page's class names are obfuscated hashes, so the phrase is the
  // anchor — and the company-speed insight must not be mistaken for it.
  const detail = parseJobDetail({
    body_text: "Vaga remota.",
    work_mode_label: "Remoto",
    posted_datetime: "",
    posted_label: "",
    posted_candidates: [
      "Promovida",
      "A empresa leva geralmente 1 semana para avaliar as candidaturas",
      "Anunciada há 2 dias",
      "há 2 dias"
    ],
    apply_url_json: ""
  }, NOW);

  assert.equal(detail.posted_at, "2026-08-04T12:00:00.000Z");
});

test("a page with no posting phrase yields no date rather than a guess", () => {
  const detail = parseJobDetail({
    body_text: "Vaga remota.",
    work_mode_label: "Remoto",
    posted_candidates: ["A empresa leva geralmente 1 semana para avaliar as candidaturas"],
    apply_url_json: ""
  }, NOW);
  assert.equal(detail.posted_at, null);
});
