import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE_SECTIONS,
  declaredDemographics,
  deriveDemographicKeywords,
  emptyProfile,
  mergeProfiles,
  normalizeProfile,
  profileCompleteness,
  profileFactsForModel
} from "./profile-schema.js";

test("an empty profile has every schema key with a typed default", () => {
  const profile = emptyProfile();
  assert.equal(profile.identity.full_name, "");
  assert.equal(profile.professional.total_software_engineering_years, null);
  assert.equal(profile.demographics.has_disability, null);
  assert.deepEqual(profile.professional.target_roles, []);
  assert.deepEqual(profile.years_by_technology, {});
  assert.deepEqual(profile.recent_experiences, []);
});

test("normalizeProfile coerces model output into the canonical types", () => {
  const profile = normalizeProfile({
    identity: { full_name: "  Gabriel   Silva ", email: "g@example.com" },
    professional: { total_software_engineering_years: "7", target_roles: "AI Engineer, Backend" },
    demographics: { has_disability: "nao", is_veteran: "yes" },
    years_by_technology: { TypeScript: "5", Python: 3 }
  });
  assert.equal(profile.identity.full_name, "Gabriel Silva");
  assert.equal(profile.professional.total_software_engineering_years, 7);
  assert.deepEqual(profile.professional.target_roles, ["AI Engineer", "Backend"]);
  assert.equal(profile.demographics.has_disability, false);
  assert.equal(profile.demographics.is_veteran, true);
  assert.deepEqual(profile.years_by_technology, { TypeScript: 5, Python: 3 });
});

test("unknown tristate input stays null instead of becoming false", () => {
  for (const value of [undefined, null, "", "talvez", 1, {}]) {
    assert.equal(normalizeProfile({ demographics: { has_disability: value } }).demographics.has_disability, null, String(value));
  }
});

test("enum fields reject values outside the allowed options", () => {
  assert.equal(normalizeProfile({ professional: { english_level: "B2" } }).professional.english_level, "B2");
  assert.equal(normalizeProfile({ professional: { english_level: "fluentissimo" } }).professional.english_level, "");
});

test("invalid year values are dropped from the technology map", () => {
  const profile = normalizeProfile({ years_by_technology: { Ok: "4", Ruim: "abc", Negativo: -2, Absurdo: 500 } });
  assert.deepEqual(profile.years_by_technology, { Ok: 4 });
});

test("record lists keep only the declared sub-fields", () => {
  const profile = normalizeProfile({
    recent_experiences: [{ company: "Acme", role: "Dev", start: "2024-01", end: null, technologies: "Node, React", lixo: "x" }]
  });
  assert.deepEqual(profile.recent_experiences[0], {
    company: "Acme",
    role: "Dev",
    start: "2024-01",
    end: "",
    technologies: ["Node", "React"]
  });
});

test("a value is accepted whether the model nests it or puts it at the root", () => {
  // Models disagree on where a section-less key belongs; both must be kept.
  assert.deepEqual(normalizeProfile({ years_by_technology: { Python: 6 } }).years_by_technology, { Python: 6 });
  assert.deepEqual(normalizeProfile({ skills: { years_by_technology: { Python: 6 } } }).years_by_technology, { Python: 6 });
  assert.equal(normalizeProfile({ full_name: "Ana" }).identity.full_name, "Ana");
  assert.equal(normalizeProfile({ identity: { full_name: "Ana" } }).identity.full_name, "Ana");
});

test("the nested placement wins when both are present", () => {
  const profile = normalizeProfile({ full_name: "Raiz", identity: { full_name: "Aninhado" } });
  assert.equal(profile.identity.full_name, "Aninhado");
});

test("normalizeProfile is idempotent", () => {
  const once = normalizeProfile({ identity: { full_name: "Ana" }, demographics: { has_disability: true } });
  assert.deepEqual(normalizeProfile(once), once);
});

test("demographic keywords are derived only from declared values", () => {
  assert.deepEqual(deriveDemographicKeywords({ has_disability: null }).has_disability, []);
  assert.ok(deriveDemographicKeywords({ has_disability: true }).has_disability.includes("Yes"));
  assert.ok(deriveDemographicKeywords({ has_disability: false }).has_disability.includes("No"));
  assert.deepEqual(deriveDemographicKeywords({ gender: "Mulher" }).gender, ["Mulher"]);
});

test("extra keywords never resurrect an undeclared demographic", () => {
  const keywords = deriveDemographicKeywords({ has_disability: null }, { has_disability: ["Yes", "Sim"] });
  assert.deepEqual(keywords.has_disability, []);
});

test("declaredDemographics reports blanks as nao_declarado", () => {
  const declared = declaredDemographics(normalizeProfile({ demographics: { has_disability: false } }));
  assert.equal(declared.pcd, "nao");
  assert.equal(declared.veterano, "nao_declarado");
  assert.equal(declared.raca_etnia, "nao_declarado");
});

test("completeness only requires the fields marked as required", () => {
  const required = PROFILE_SECTIONS.flatMap((section) =>
    section.fields.filter((field) => field.required).map((field) => `${section.key}.${field.key}`)
  );
  assert.deepEqual(profileCompleteness(emptyProfile()).missing, required);
  const filled = normalizeProfile({ identity: { full_name: "Ana", email: "a@x.com" } });
  assert.equal(profileCompleteness(filled).complete, true);
});

test("the database profile wins over profile.json but never erases it", () => {
  const file = {
    identity: { full_name: "Nome do arquivo", city: "Brasilia", postal_code: "01310100" },
    professional: { facts: ["fato antigo"], english_level: "B1" },
    custom_key: "preservado"
  };
  const db = normalizeProfile({
    identity: { full_name: "Nome do banco" },
    professional: { english_level: "C1" }
  });
  const merged = mergeProfiles(file, db);
  assert.equal(merged.identity.full_name, "Nome do banco");
  assert.equal(merged.identity.city, "Brasilia");
  assert.equal(merged.identity.postal_code, "01310100");
  assert.equal(merged.professional.english_level, "C1");
  assert.deepEqual(merged.professional.facts, ["fato antigo"]);
  assert.equal(merged.custom_key, "preservado");
});

test("merging without a database profile returns the file untouched", () => {
  const file = { identity: { full_name: "Ana" } };
  assert.equal(mergeProfiles(file, null), file);
});

test("the model payload carries the resume and hides undeclared demographics", () => {
  const profile = normalizeProfile({
    identity: { full_name: "Ana", city: "Recife", country: "Brasil", email: "a@x.com", phone_number_digits: "81999998888" },
    demographics: { gender: "Mulher" }
  });
  const payload = profileFactsForModel(profile, "Texto do curriculo");

  assert.equal(payload.resume_text, "Texto do curriculo");
  assert.equal(payload.declared_demographics.genero, "Mulher");
  assert.equal(payload.declared_demographics.pcd, "nao_declarado");
  // Raw demographics must not leak: only the declared view is exposed.
  assert.equal(payload.demographics, undefined);
  // Contact details the model has no business reasoning about stay out too.
  assert.equal(payload.identity.phone_number_digits, undefined);
  assert.equal(payload.identity.full_name, "Ana");
});

test("the resume excerpt sent to the model is bounded", () => {
  const payload = profileFactsForModel(emptyProfile(), "x".repeat(50000));
  assert.equal(payload.resume_text.length, 12000);
});
