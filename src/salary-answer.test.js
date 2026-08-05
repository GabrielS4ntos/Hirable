import assert from "node:assert/strict";
import test from "node:test";
import { SAFETY } from "./config-defaults.js";
import { explainSalaryRefusal, isSalaryLabel, readSalaryUnits, resolveSalaryAnswer } from "./salary-answer.js";

const profile = {
  professional: {
    expected_salary_brl_monthly: 25000,
    expected_salary_usd_gross_monthly: 9000
  }
};

/* ------------------------------------------------------- guard rails, PT+EN */

test("every sensitive label is blocked in both languages", () => {
  const patterns = SAFETY.blocked_question_patterns.map((pattern) => new RegExp(pattern, "i"));
  const blocked = (label) => patterns.some((re) => re.test(label));

  // The Portuguese half of this list used to pass straight through.
  const sensitive = [
    "Desired salary", "Pretensão salarial", "Qual sua pretensão salarial?", "Remuneração pretendida",
    "Do you require visa sponsorship?", "Você precisa de visto de trabalho?",
    "What is your notice period?", "Qual seu aviso prévio?", "Data de início desejada",
    "Gender", "Gênero", "Race", "Raça/etnia", "Disability", "Você é PCD?",
    "Are you a veteran?", "É veterano?", "Orientação sexual",
    "Date of birth", "Data de nascimento", "Qual sua idade?",
    "Criminal record", "Antecedentes criminais", "Informe seu CPF", "Número do RG"
  ];
  const leaking = sensitive.filter((label) => !blocked(label));
  assert.deepEqual(leaking, [], "nenhum rotulo sensivel pode passar");
});

test("ordinary questions are not caught by the guard rails", () => {
  const patterns = SAFETY.blocked_question_patterns.map((pattern) => new RegExp(pattern, "i"));
  const blocked = (label) => patterns.some((re) => re.test(label));

  // A guard rail that blocks everything is as useless as one that blocks nothing.
  const ordinary = [
    "Nome completo", "Full name", "E-mail", "Cidade", "City",
    "Anos de experiência com Node.js", "Years of experience with Go",
    "LinkedIn profile URL", "Por que você quer trabalhar aqui?"
  ];
  assert.deepEqual(ordinary.filter(blocked), [], "nenhuma pergunta comum pode ser bloqueada");
});

/* ------------------------------------------------------------------ units */

test("currency and period are read from the label", () => {
  assert.deepEqual(readSalaryUnits("Pretensão salarial mensal (R$)"), { currency: "BRL", period: "month" });
  assert.deepEqual(readSalaryUnits("Expected annual salary (USD)"), { currency: "USD", period: "year" });
  assert.deepEqual(readSalaryUnits("Hourly rate in EUR"), { currency: "EUR", period: "hour" });
  assert.deepEqual(readSalaryUnits("Salary expectation"), { currency: null, period: null });
});

test("hour beats year beats month, so a long label cannot be misread", () => {
  assert.equal(readSalaryUnits("Hourly rate (US$) — annual contract").period, "hour");
  assert.equal(readSalaryUnits("Pretensão anual em reais, informe o valor mensal x12").period, "year");
});

/* --------------------------------------------------------------- answering */

test("a monthly figure is used as declared", () => {
  const answer = resolveSalaryAnswer("Pretensão salarial mensal (R$)", profile);
  assert.equal(answer.value, "25000");
  assert.equal(answer.currency, "BRL");
});

test("an annual field is twelve months, not the monthly number", () => {
  // The 12x mistake this module exists to prevent.
  const answer = resolveSalaryAnswer("Expected annual salary (USD)", profile);
  assert.equal(answer.value, "108000");
  assert.equal(answer.period, "year");
});

test("an hourly field keeps cents", () => {
  const answer = resolveSalaryAnswer("Hourly rate (US$)", profile);
  assert.equal(answer.value, (9000 / 176).toFixed(2));
});

test("an ambiguous label is refused rather than guessed", () => {
  assert.equal(resolveSalaryAnswer("Salary expectation", profile), null);
  assert.equal(resolveSalaryAnswer("Pretensão salarial", profile), null);
  assert.equal(explainSalaryRefusal("Salary expectation", profile), "moeda_e_periodo_nao_declarados_no_rotulo");
});

test("a missing half of the unit is still a refusal", () => {
  assert.equal(resolveSalaryAnswer("Pretensão mensal", profile), null, "sem moeda");
  assert.equal(resolveSalaryAnswer("Salário em reais", profile), null, "sem periodo");
  assert.equal(explainSalaryRefusal("Pretensão mensal", profile), "moeda_nao_declarada_no_rotulo");
  assert.equal(explainSalaryRefusal("Salário em reais", profile), "periodo_nao_declarado_no_rotulo");
});

test("a currency the profile never declared is refused, never converted", () => {
  // Inventing an exchange rate would put a number the user never said in front
  // of a recruiter as if they had.
  assert.equal(resolveSalaryAnswer("Salaire mensuel (€)", profile), null);
  assert.equal(explainSalaryRefusal("Monthly salary (€)", profile), "perfil_sem_pretensao_em_eur");

  const brlOnly = { professional: { expected_salary_brl_monthly: 25000 } };
  assert.equal(resolveSalaryAnswer("Monthly salary (USD)", brlOnly), null);
  assert.equal(resolveSalaryAnswer("Pretensão mensal (R$)", brlOnly).value, "25000");
});

test("an empty or zero expectation is not an answer", () => {
  assert.equal(resolveSalaryAnswer("Pretensão mensal (R$)", { professional: { expected_salary_brl_monthly: 0 } }), null);
  assert.equal(resolveSalaryAnswer("Pretensão mensal (R$)", {}), null);
  assert.equal(resolveSalaryAnswer("Pretensão mensal (R$)", null), null);
});

test("non-salary fields are none of this module's business", () => {
  assert.equal(isSalaryLabel("Nome completo"), false);
  assert.equal(resolveSalaryAnswer("Anos de experiência (mensal)", profile), null);
  assert.equal(explainSalaryRefusal("Nome completo", profile), null);
});
