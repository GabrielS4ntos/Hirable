import assert from "node:assert/strict";
import test from "node:test";
import { PROFILE_SECTIONS, buildProfileResponseSchema, canonicalOption, declaredDemographics, deriveDemographicKeywords, emptyProfile, normalizeProfile, profileCompleteness, profileFactsForModel } from "./profile-schema.js";

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
  const filled = normalizeProfile({ identity: { full_name: "Ana", email: "a@x.com" }, professional: { target_roles: ["Developer"] } });
  assert.equal(profileCompleteness(filled).complete, true);
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

test("demographic selects accept a listed option and free text alike", () => {
  // The curated lists never cover everyone, so a value outside them is kept.
  const listed = normalizeProfile({ demographics: { gender: "Mulher", race_ethnicity: "Parda" } });
  assert.equal(listed.demographics.gender, "Mulher");
  assert.equal(listed.demographics.race_ethnicity, "Parda");

  const free = normalizeProfile({ demographics: { gender: "Gênero fluido", sexual_orientation: "Pansexual" } });
  assert.equal(free.demographics.gender, "Gênero fluido");
  assert.equal(free.demographics.sexual_orientation, "Pansexual");

  // Blank still means "not declared", which is what blocks restricted vacancies.
  assert.equal(normalizeProfile({ demographics: { gender: "" } }).demographics.gender, "");
  assert.equal(declaredDemographics(normalizeProfile({})).genero, "nao_declarado");
});

test("free-text demographics still produce matching option keywords", () => {
  const profile = normalizeProfile({ demographics: { gender: "Gênero fluido" } });
  assert.deepEqual(profile.demographics.option_keywords.gender, ["Gênero fluido"]);
});

test("years by technology arrives from the model as tuples", () => {
  // The structured-output schema cannot express a free-form map, so the agent
  // returns [{technology, years}] and it is folded into the canonical map.
  const profile = normalizeProfile({
    years_by_technology: [
      { technology: "Python", years: 6 },
      { technology: "TypeScript", years: "5" },
      { technology: "", years: 3 },
      { technology: "Ruim", years: "abc" }
    ]
  });
  assert.deepEqual(profile.years_by_technology, { Python: 6, TypeScript: 5 });
});

test("experiences and education are part of the extraction contract", () => {
  const schema = buildProfileResponseSchema();
  const properties = schema.properties.profile.properties;
  assert.equal(properties.recent_experiences.type, "array");
  assert.equal(properties.education.type, "array");
  assert.ok(properties.recent_experiences.items.properties.company);
  assert.ok(properties.education.items.properties.institution);
  // Required, so the model always returns the key even when the resume is silent.
  assert.ok(schema.properties.profile.required.includes("recent_experiences"));
  assert.ok(schema.properties.profile.required.includes("education"));
});

test("every user-facing label is written in proper Portuguese", () => {
  // Labels are rendered verbatim in the interface: no unaccented placeholders.
  const wrong = /\b(Genero|Formacao|Experiencias|Titulo|Area|Instituicao|Conclusao|Raca|deficiencia|Nivel|ingles|Codigo|digitos|Pais|experiencia|verificaveis|sensiveis|Orientacao|Multipla|Fisica|Indigena|Cisgenero|Transgenero|binario)\b/;
  for (const section of PROFILE_SECTIONS) {
    assert.doesNotMatch(section.label, wrong, `section ${section.key}`);
    if (section.description) assert.doesNotMatch(section.description, wrong, `description ${section.key}`);
    for (const field of section.fields) {
      assert.doesNotMatch(field.label, wrong, `${section.key}.${field.key}`);
      if (field.hint) assert.doesNotMatch(field.hint, wrong, `hint ${field.key}`);
      for (const option of field.options || []) assert.doesNotMatch(option, wrong, `option ${option}`);
      for (const sub of field.item_fields || []) assert.doesNotMatch(sub.label, wrong, `sub ${sub.key}`);
    }
  }
});

test("a value that is an option, spelled differently, is snapped to the option", () => {
  // The extraction agent writes "preta"; the list says "Preta". Treating them as
  // different opened a free-text box under a field the user had answered, and
  // handed the eligibility guard a spelling it does not compare against.
  const profile = normalizeProfile({
    demographics: { race_ethnicity: "preta", gender: "MULHER", gender_identity: "cisgenero" }
  });
  assert.equal(profile.demographics.race_ethnicity, "Preta");
  assert.equal(profile.demographics.gender, "Mulher");
  assert.equal(profile.demographics.gender_identity, "Cisgênero");
});

test("a value that is genuinely outside the list survives untouched", () => {
  // The whole point of enum_or_text: these categories never cover everyone.
  const profile = normalizeProfile({ demographics: { gender: "Agênero" } });
  assert.equal(profile.demographics.gender, "Agênero");
});

test("canonicalOption ignores accents, case and inflection — and nothing more", () => {
  const options = ["Branca", "Preta", "Parda", "Não-binário"];
  assert.equal(canonicalOption("nao-binario", options), "Não-binário");
  assert.equal(canonicalOption("  parda  ", options), "Parda");
  // Same answer, masculine inflection.
  assert.equal(canonicalOption("pardo", options), "Parda");
  // A different answer stays a different answer.
  assert.equal(canonicalOption("Prefiro não informar", options), "Prefiro não informar");
  assert.equal(canonicalOption("", options), "");
});

test("an English answer is accepted as the option it means", () => {
  // The extraction agent reads English forms and résumés; "White" and "Branca"
  // are the same answer, and treating them as different littered the profile
  // form with free-text boxes under questions the user had already answered.
  const profile = normalizeProfile({
    demographics: { gender: "Male", gender_identity: "Cisgender man", race_ethnicity: "White", sexual_orientation: "Heterosexual" }
  });
  assert.equal(profile.demographics.gender, "Homem");
  assert.equal(profile.demographics.gender_identity, "Cisgênero");
  assert.equal(profile.demographics.race_ethnicity, "Branca");
  assert.equal(profile.demographics.sexual_orientation, "Heterossexual");
});

test("an alias never crosses into a list that does not offer it", () => {
  // "white" maps to "Branca", which is not a gender: the alias must be ignored
  // when the field's own list has no such option.
  assert.equal(canonicalOption("White", ["Mulher", "Homem", "Não-binário"]), "White");
  assert.equal(canonicalOption("Male", ["Branca", "Preta"]), "Male");
});
