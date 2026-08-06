import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkMode, parsePostedAt, normalizeJobCard, findPostedLabel } from "./job-card.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");

test("reads work mode in both languages", () => {
  assert.equal(parseWorkMode("Remoto"), "remote");
  assert.equal(parseWorkMode("Remote"), "remote");
  assert.equal(parseWorkMode("Híbrido"), "hybrid");
  assert.equal(parseWorkMode("Hybrid"), "hybrid");
  assert.equal(parseWorkMode("Presencial"), "onsite");
  assert.equal(parseWorkMode("On-site"), "onsite");
});

test("an unreadable work mode is unknown, never a guess", () => {
  assert.equal(parseWorkMode("São Paulo, Brasil"), "unknown");
  assert.equal(parseWorkMode(""), "unknown");
  assert.equal(parseWorkMode(null), "unknown");
});

test("hybrid wins over remote when both words appear", () => {
  // "Híbrido - trabalho remoto parcial" must not be read as fully remote.
  assert.equal(parseWorkMode("Híbrido - trabalho remoto parcial"), "hybrid");
});

test("the datetime attribute wins over the relative label", () => {
  const iso = parsePostedAt("2026-08-01T09:00:00.000Z", "há 3 dias", NOW);
  assert.equal(iso, "2026-08-01T09:00:00.000Z");
});

test("falls back to the relative label in both languages", () => {
  assert.equal(parsePostedAt(null, "há 3 dias", NOW), "2026-08-03T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "3 days ago", NOW), "2026-08-03T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "2 semanas atrás", NOW), "2026-07-23T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "1 month ago", NOW), "2026-07-07T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "há 5 horas", NOW), "2026-08-06T07:00:00.000Z");
});

test("an unreadable date is null, so freshness cannot be decided on a guess", () => {
  assert.equal(parsePostedAt(null, "recentemente", NOW), null);
  assert.equal(parsePostedAt(null, null, NOW), null);
});

test("normalizes a full card", () => {
  const card = normalizeJobCard({
    external_id: "4321",
    url: "https://www.linkedin.com/jobs/view/4321/?trackingId=abc",
    apply_url: "",
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "Brasil",
    work_mode_label: "Remoto",
    posted_datetime: null,
    posted_label: "há 2 dias",
    easy_apply: true,
    applied: false,
    sponsored: false,
    text: "Senior Backend Engineer\nAcme\nBrasil (Remoto)\nCandidatura simplificada"
  }, { searchName: "Backend", now: NOW });

  assert.equal(card.external_id, "4321");
  assert.equal(card.search_name, "Backend");
  assert.equal(card.work_mode, "remote");
  assert.equal(card.posted_at, "2026-08-04T12:00:00.000Z");
  assert.equal(card.easy_apply, true);
  assert.equal(card.apply_url, "https://www.linkedin.com/jobs/view/4321/apply/?openSDUIApplyFlow=true");
  assert.equal(card.compact_text.length <= 500, true);
});

test("falls back to the card text when there is no work mode badge", () => {
  const card = normalizeJobCard({
    external_id: "9",
    url: "https://www.linkedin.com/jobs/view/9/",
    title: "Dev",
    company: "Acme",
    location: "Curitiba, PR",
    work_mode_label: "",
    posted_label: "há 1 dia",
    text: "Dev\nAcme\nCuritiba, PR (Presencial)"
  }, { searchName: "Dev", now: NOW });

  assert.equal(card.work_mode, "onsite");
});

test("a card with no id is rejected", () => {
  assert.equal(normalizeJobCard({ title: "Dev" }, { searchName: "x", now: NOW }), null);
});

test("reads the posting age out of a metadata phrase, not just a <time> element", () => {
  // LinkedIn renders the age as an ordinary span on most cards; relying on
  // <time> alone left two thirds of a real scan with no date at all.
  assert.equal(parsePostedAt(null, "Publicada há 2 dias", NOW), "2026-08-04T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "Reposted 3 days ago", NOW), "2026-08-03T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "Anunciada há 1 semana", NOW), "2026-07-30T12:00:00.000Z");
});

test("today and yesterday are dates, not unknowns", () => {
  assert.equal(parsePostedAt(null, "hoje", NOW), "2026-08-06T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "today", NOW), "2026-08-06T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "ontem", NOW), "2026-08-05T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "yesterday", NOW), "2026-08-05T12:00:00.000Z");
});

test("a card carries the age found in its metadata", () => {
  const card = normalizeJobCard({
    external_id: "55",
    url: "https://www.linkedin.com/jobs/view/55/",
    title: "Dev",
    company: "Acme",
    posted_label: "Publicada há 4 dias",
    text: "Dev Acme"
  }, { searchName: "x", now: NOW });

  assert.equal(card.posted_at, "2026-08-02T12:00:00.000Z");
});

test("only a posting phrase counts as a date, never a stray age", () => {
  // Real page text. "A empresa leva geralmente 1 semana para avaliar" is the
  // company's response speed, and matching it produced a fabricated date.
  assert.equal(findPostedLabel(["A empresa leva geralmente 1 semana para avaliar as candidaturas"]), "");
  assert.equal(findPostedLabel(["há 6 minutos"]), "");
  assert.equal(findPostedLabel(["Visualizado", "Candidatura simplificada"]), "");
});

test("finds the posting phrase in both languages", () => {
  assert.equal(findPostedLabel(["Anunciada há 2 dias"]), "Anunciada há 2 dias");
  assert.equal(findPostedLabel(["Publicada há 3 semanas"]), "Publicada há 3 semanas");
  assert.equal(findPostedLabel(["Posted 4 days ago"]), "Posted 4 days ago");
  assert.equal(findPostedLabel(["Reposted 1 week ago"]), "Reposted 1 week ago");
});

test("picks the posting phrase out of a noisy list", () => {
  const found = findPostedLabel([
    "Promovida",
    "A empresa leva geralmente 1 semana para avaliar as candidaturas",
    "Anunciada há 2 dias",
    "há 2 dias"
  ]);
  assert.equal(found, "Anunciada há 2 dias");
  assert.equal(parsePostedAt(null, found, NOW), "2026-08-04T12:00:00.000Z");
});

test("a posting phrase without an age is not a date", () => {
  assert.equal(findPostedLabel(["Anunciada recentemente"]), "");
});

test("counts a spelled-out article as one, in both languages", () => {
  // LinkedIn writes the singular without a digit: "Posted a week ago",
  // "an hour ago", "há uma semana". Requiring \d+ silently dropped the date and
  // the job was then rejected as undated — over-rejection, not safety.
  assert.equal(parsePostedAt(null, "Posted a week ago", NOW), "2026-07-30T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "Reposted an hour ago", NOW), "2026-08-06T11:00:00.000Z");
  assert.equal(parsePostedAt(null, "Anunciada há uma semana", NOW), "2026-07-30T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "Publicado há um dia", NOW), "2026-08-05T12:00:00.000Z");
});

test("the article form is recognised as a posting phrase too", () => {
  assert.equal(findPostedLabel(["Posted a week ago"]), "Posted a week ago");
  assert.equal(findPostedLabel(["Anunciada há uma semana"]), "Anunciada há uma semana");
});

test("an article without a unit is still not a date", () => {
  // "a" and "an" are far too common to treat as a quantity on their own.
  assert.equal(findPostedLabel(["Posted a job"]), "");
  assert.equal(parsePostedAt(null, "Posted a job", NOW), null);
});
