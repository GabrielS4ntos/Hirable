import assert from "node:assert/strict";
import test from "node:test";
import { checkJobEligibility, detectRestrictedGroups } from "./job-eligibility.js";

const job = (compactText, extra = {}) => ({
  external_id: "1",
  title: "Software Engineer",
  company: "Acme",
  location: "Remote",
  compact_text: compactText,
  ...extra
});

const profileWith = (demographics) => ({ demographics });

const NOT_DECLARED = profileWith({ has_disability: null, is_veteran: null, gender: "", race_ethnicity: "", sexual_orientation: "" });

test("an ordinary job is not restricted", () => {
  assert.deepEqual(detectRestrictedGroups("Senior Software Engineer, remote, TypeScript and AWS"), []);
  const result = checkJobEligibility(job("Senior Software Engineer, remote"), NOT_DECLARED);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.groups, []);
});

test("diversity boilerplate alone never blocks a job", () => {
  const texts = [
    "Somos uma empresa inclusiva. Pessoas com deficiencia sao bem-vindas a se candidatar.",
    "We are an equal opportunity employer and welcome applicants with disabilities.",
    "Valorizamos diversidade: mulheres, pessoas negras e LGBTQIA+ sao incentivadas a participar."
  ];
  for (const text of texts) {
    assert.deepEqual(detectRestrictedGroups(text), [], text);
    assert.equal(checkJobEligibility(job(text), NOT_DECLARED).allowed, true, text);
  }
});

test("a PCD-exclusive job is blocked when disability status was not declared", () => {
  const result = checkJobEligibility(job("Vaga exclusiva para PCD - Desenvolvedor Backend"), NOT_DECLARED);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.groups, ["pcd"]);
  assert.equal(result.declared, "nao_declarado");
  assert.match(result.reason, /nao declara pertencer/i);
});

test("a PCD-exclusive job is blocked when the user declared they are not PCD", () => {
  const result = checkJobEligibility(
    job("Vaga afirmativa para pessoas com deficiencia"),
    profileWith({ has_disability: false })
  );
  assert.equal(result.allowed, false);
  assert.equal(result.declared, "declarado_nao");
  assert.match(result.reason, /declara nao pertencer/i);
});

test("a PCD-exclusive job is allowed when the user declared they are PCD", () => {
  const result = checkJobEligibility(
    job("Vaga exclusiva para PCD - Desenvolvedor Backend"),
    profileWith({ has_disability: true })
  );
  assert.equal(result.allowed, true);
  assert.equal(result.declared, "declarado_sim");
});

test("accents and casing do not change detection", () => {
  for (const text of ["VAGA EXCLUSIVA PARA PESSOAS COM DEFICIÊNCIA", "vaga exclusiva para pessoas com deficiencia"]) {
    assert.equal(checkJobEligibility(job(text), NOT_DECLARED).allowed, false, text);
  }
});

test("english exclusivity wording is detected", () => {
  const result = checkJobEligibility(job("This role is reserved for candidates with disabilities."), NOT_DECLARED);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.groups, ["pcd"]);
});

test("veteran-only jobs follow the same rule", () => {
  assert.equal(checkJobEligibility(job("Position only for veterans"), NOT_DECLARED).allowed, false);
  assert.equal(checkJobEligibility(job("Position only for veterans"), profileWith({ is_veteran: true })).allowed, true);
  assert.equal(checkJobEligibility(job("Position only for veterans"), profileWith({ is_veteran: false })).allowed, false);
});

test("gender-restricted jobs compare against the declared gender", () => {
  const text = "Vaga afirmativa exclusiva para mulheres em tecnologia";
  assert.equal(checkJobEligibility(job(text), NOT_DECLARED).allowed, false);
  assert.equal(checkJobEligibility(job(text), profileWith({ gender: "Mulher" })).allowed, true);
  assert.equal(checkJobEligibility(job(text), profileWith({ gender: "Feminino" })).allowed, true);
  assert.equal(checkJobEligibility(job(text), profileWith({ gender: "Homem" })).allowed, false);
});

test("race-restricted jobs compare against the declared race", () => {
  const text = "Programa afirmativo para pessoas negras";
  assert.equal(checkJobEligibility(job(text), NOT_DECLARED).allowed, false);
  assert.equal(checkJobEligibility(job(text), profileWith({ race_ethnicity: "Negra" })).allowed, true);
  assert.equal(checkJobEligibility(job(text), profileWith({ race_ethnicity: "Branca" })).allowed, false);
});

test("restriction is detected in the title as well as the body", () => {
  const result = checkJobEligibility(
    { title: "Desenvolvedor Java - Vaga exclusiva para PCD", compact_text: "Java, Spring, remoto" },
    NOT_DECLARED
  );
  assert.equal(result.allowed, false);
});

test("short group acronyms do not match inside other words", () => {
  // "pcd" inside "upcdate"-like noise, and unrelated words containing "pwd".
  assert.deepEqual(detectRestrictedGroups("exclusiva para upcd e senhas pwds"), []);
  assert.deepEqual(detectRestrictedGroups("exclusive for the pwdx team"), []);
});

test("a group term far away from the exclusivity marker does not trigger", () => {
  const text = `Vaga exclusiva para engenheiros seniores. ${"contexto irrelevante ".repeat(20)} pessoas com deficiencia sao bem-vindas.`;
  assert.deepEqual(detectRestrictedGroups(text), []);
});

test("multiple restricted groups are reported together", () => {
  const result = checkJobEligibility(job("Vaga exclusiva para mulheres e pessoas negras"), NOT_DECLARED);
  assert.equal(result.allowed, false);
  assert.equal(result.groups.length, 2);
});

test("a missing profile blocks any restricted job", () => {
  assert.equal(checkJobEligibility(job("Vaga exclusiva para PCD"), null).allowed, false);
  assert.equal(checkJobEligibility(job("Vaga exclusiva para PCD"), {}).allowed, false);
});
