/**
 * Canonical shape of the user profile collected during onboarding.
 *
 * One source of truth for three consumers:
 *  - the web UI, which renders the onboarding and profile screens from it;
 *  - the extraction agent, whose prompt is generated from these descriptors;
 *  - the pipelines, which send these facts to the models alongside the resume.
 *
 * Field types:
 *  text | textarea | number | enum | tristate | string_list | years_map | record_list
 *
 * `tristate` is null / true / false, where null means "not informed". This matters
 * for eligibility: an unknown disability status must never be treated as a "yes".
 */

export const PROFILE_SECTIONS = [
  {
    key: "identity",
    label: "Identidade e contato",
    description: "Usado para preencher os campos fixos do formulário Easy Apply.",
    fields: [
      { key: "full_name", label: "Nome completo", type: "text", required: true, hint: "Como aparece no currículo." },
      { key: "name_aliases", label: "Outros nomes usados", type: "string_list", hint: "Nome de exibição no LinkedIn, apelido profissional." },
      { key: "email", label: "E-mail", type: "text", required: true },
      { key: "phone_country", label: "Código do país do telefone", type: "text", hint: "Exatamente como o LinkedIn mostra, ex: Brazil (+55)." },
      { key: "phone_number_digits", label: "Telefone (somente dígitos)", type: "text" },
      { key: "city", label: "Cidade", type: "text" },
      { key: "country", label: "País", type: "text" },
      { key: "postal_code", label: "CEP", type: "text" },
      { key: "linkedin_url", label: "URL do LinkedIn", type: "text" }
    ]
  },
  {
    key: "professional",
    label: "Perfil profissional",
    description: "Base para a avaliação de aderência das vagas.",
    fields: [
      { key: "headline", label: "Título profissional", type: "text", hint: "Ex: AI Software Engineer | Full Stack Developer." },
      { key: "target_roles", label: "Cargos-alvo", type: "string_list" },
      { key: "total_software_engineering_years", label: "Anos de experiência total", type: "number" },
      { key: "seniority", label: "Senioridade", type: "enum", options: ["junior", "pleno", "senior", "staff", "principal"] },
      { key: "english_level", label: "Nível de inglês", type: "enum", options: ["A1", "A2", "B1", "B2", "C1", "C2", "native"] },
      { key: "other_languages", label: "Outros idiomas", type: "string_list", hint: "Ex: Espanhol - B1." },
      { key: "expected_salary_usd_gross_monthly", label: "Pretensão mensal (USD bruto)", type: "number" },
      { key: "expected_salary_brl_monthly", label: "Pretensão mensal (BRL)", type: "number" },
      { key: "recent_core_technologies", label: "Tecnologias principais", type: "string_list" },
      { key: "facts", label: "Fatos verificáveis", type: "string_list", hint: "Frases curtas que os agentes podem usar em respostas e formulários." }
    ]
  },
  {
    key: "work_eligibility",
    label: "Disponibilidade e elegibilidade",
    description: "Define a quais vagas o agente pode se candidatar.",
    fields: [
      { key: "work_authorization_countries", label: "Países onde pode trabalhar legalmente", type: "string_list" },
      { key: "requires_visa_sponsorship", label: "Precisa de patrocínio de visto", type: "tristate" },
      { key: "willing_to_relocate", label: "Aceita mudar de cidade/país", type: "tristate" },
      { key: "remote_only", label: "Somente vagas remotas", type: "tristate" },
      { key: "notice_period_days", label: "Aviso prévio (dias)", type: "number" },
      { key: "available_from", label: "Disponível a partir de", type: "text", hint: "Data ou texto curto, ex: imediato." }
    ]
  },
  {
    key: "demographics",
    label: "Dados sensíveis e vagas afirmativas",
    description:
      "Preencha apenas o que aceitar declarar. Sem estes dados o agente NÃO se candidata a vagas exclusivas " +
      "(PCD, veteranos, programas afirmativos) e opta por 'prefiro não responder' nos formulários.",
    sensitive: true,
    fields: [
      { key: "has_disability", label: "Pessoa com deficiência (PCD)", type: "tristate", hint: "Deixe em branco para nunca declarar." },
      {
        key: "disability_details",
        label: "Tipo de deficiência",
        type: "enum_or_text",
        options: ["Física", "Auditiva", "Visual", "Intelectual", "Múltipla", "Reabilitado do INSS"],
        hint: "Opcional. Usado apenas se você declarar ser PCD."
      },
      { key: "is_veteran", label: "Veterano das forças armadas", type: "tristate" },
      {
        key: "gender",
        label: "Gênero",
        type: "enum_or_text",
        options: ["Mulher", "Homem", "Não-binário"]
      },
      {
        key: "gender_identity",
        label: "Identidade de gênero",
        type: "enum_or_text",
        options: ["Cisgênero", "Transgênero", "Não-binário"]
      },
      {
        key: "race_ethnicity",
        label: "Raça / etnia",
        type: "enum_or_text",
        // Categorias do IBGE, que são as usadas nos formulários brasileiros.
        options: ["Branca", "Preta", "Parda", "Amarela", "Indígena"]
      },
      {
        key: "sexual_orientation",
        label: "Orientação sexual",
        type: "enum_or_text",
        options: ["Heterossexual", "Homossexual", "Bissexual", "Assexual"]
      }
    ]
  },
  {
    key: "skills",
    label: "Anos por tecnologia",
    description: "Responde diretamente às perguntas 'quantos anos de experiência com X' do Easy Apply.",
    fields: [
      { key: "years_by_technology", label: "Anos por tecnologia", type: "years_map", hint: "Ex: TypeScript = 5." }
    ]
  },
  {
    key: "recent_experiences",
    label: "Experiências recentes",
    fields: [
      {
        key: "recent_experiences",
        label: "Experiências",
        type: "record_list",
        item_fields: [
          { key: "company", label: "Empresa", type: "text" },
          { key: "role", label: "Cargo", type: "text" },
          { key: "start", label: "Início (AAAA-MM)", type: "text" },
          { key: "end", label: "Fim (AAAA-MM ou vazio)", type: "text" },
          { key: "technologies", label: "Tecnologias", type: "string_list" }
        ]
      }
    ]
  },
  {
    key: "education",
    label: "Formação",
    fields: [
      {
        key: "education",
        label: "Formações",
        type: "record_list",
        item_fields: [
          { key: "degree", label: "Título", type: "text" },
          { key: "field", label: "Área", type: "text" },
          { key: "institution", label: "Instituição", type: "text" },
          { key: "end", label: "Conclusão", type: "text" }
        ]
      }
    ]
  }
];

/** Sections whose values are stored directly under the section key. */
const FLAT_SECTIONS = ["identity", "professional", "work_eligibility", "demographics"];

export function emptyProfile() {
  const profile = {};
  for (const section of PROFILE_SECTIONS) {
    if (FLAT_SECTIONS.includes(section.key)) {
      profile[section.key] = {};
      for (const field of section.fields) profile[section.key][field.key] = defaultValue(field);
    } else {
      for (const field of section.fields) profile[field.key] = defaultValue(field);
    }
  }
  profile.demographics.option_keywords = {};
  return profile;
}

function defaultValue(field) {
  switch (field.type) {
    case "string_list":
    case "record_list":
      return [];
    case "years_map":
      return {};
    case "tristate":
      return null;
    case "number":
      return null;
    default:
      return "";
  }
}

function cleanText(value, limit = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function coerce(field, value) {
  switch (field.type) {
    case "number": {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "tristate": {
      if (value === true || value === "true" || value === "sim" || value === "yes") return true;
      if (value === false || value === "false" || value === "nao" || value === "não" || value === "no") return false;
      return null;
    }
    case "string_list": {
      const list = Array.isArray(value) ? value : String(value ?? "").split(/[,\n;]/);
      return Array.from(new Set(list.map((item) => cleanText(item, 200)).filter(Boolean))).slice(0, 40);
    }
    case "years_map": {
      // Accepts both the internal map form and the [{technology, years}] array the
      // structured-output schema uses, since JSON Schema cannot express free-form keys.
      const entries = Array.isArray(value)
        ? value.map((item) => [item?.technology ?? item?.tech ?? item?.name, item?.years])
        : (value && typeof value === "object" ? Object.entries(value) : []);
      const map = {};
      for (const [rawKey, rawValue] of entries.slice(0, 60)) {
        const key = cleanText(rawKey, 60);
        const years = Number(rawValue);
        if (key && Number.isFinite(years) && years >= 0 && years <= 60) map[key] = Math.round(years * 10) / 10;
      }
      return map;
    }
    case "record_list": {
      if (!Array.isArray(value)) return [];
      return value.slice(0, 20).map((item) => {
        const record = {};
        for (const subField of field.item_fields || []) record[subField.key] = coerce(subField, item?.[subField.key]);
        return record;
      });
    }
    case "enum": {
      const text = cleanText(value, 40);
      return (field.options || []).includes(text) ? text : "";
    }

    // A curated list plus free text: these categories never cover everyone, so a
    // value outside the list is kept instead of silently discarded.
    case "enum_or_text":
      return cleanText(value, 120);
    default:
      return cleanText(value, field.key === "disability_details" ? 300 : 400);
  }
}

/**
 * Coerces arbitrary input (model output or form submission) into the canonical shape.
 *
 * A field is accepted both nested under its section key and at the root, because
 * models legitimately disagree on where a section-less key belongs and losing an
 * extracted value to a placement detail would be silent data loss.
 */
export function normalizeProfile(input = {}) {
  const profile = emptyProfile();
  const pick = (sectionKey, fieldKey) => {
    const nested = input?.[sectionKey]?.[fieldKey];
    const root = input?.[fieldKey];
    return nested === undefined || nested === null ? root : nested;
  };

  for (const section of PROFILE_SECTIONS) {
    if (FLAT_SECTIONS.includes(section.key)) {
      for (const field of section.fields) {
        profile[section.key][field.key] = coerce(field, pick(section.key, field.key));
      }
    } else {
      for (const field of section.fields) profile[field.key] = coerce(field, pick(section.key, field.key));
    }
  }
  profile.demographics.option_keywords = deriveDemographicKeywords(profile.demographics, input?.demographics?.option_keywords);
  return profile;
}

/**
 * Builds the option keywords used to match a demographic answer against the exact
 * option labels a form shows. Derived from the declared values so the user never
 * has to hand-write them, and empty whenever a value was not declared.
 */
export function deriveDemographicKeywords(demographics = {}, extra = {}) {
  const keywords = {
    has_disability: [],
    is_veteran: [],
    gender: [],
    gender_identity: [],
    race_ethnicity: [],
    sexual_orientation: []
  };

  const yes = ["Yes", "Sim"];
  const no = ["No", "Não", "Nao"];

  if (demographics.has_disability === true) {
    keywords.has_disability = [...yes, "I have a disability", "Sim, sou PCD", "Pessoa com deficiência"];
  } else if (demographics.has_disability === false) {
    keywords.has_disability = [...no, "I don't have a disability", "I do not have a disability", "Não sou PCD"];
  }

  if (demographics.is_veteran === true) keywords.is_veteran = [...yes, "I am a veteran", "Sou veterano"];
  else if (demographics.is_veteran === false) keywords.is_veteran = [...no, "I am not a veteran", "Não sou veterano"];

  for (const key of ["gender", "gender_identity", "race_ethnicity", "sexual_orientation"]) {
    const value = cleanText(demographics[key], 80);
    if (value) keywords[key] = [value];
  }

  // Caller-supplied keywords are additive and never resurrect an undeclared field.
  for (const [key, list] of Object.entries(extra || {})) {
    if (!(key in keywords) || keywords[key].length === 0) continue;
    const clean = (Array.isArray(list) ? list : []).map((item) => cleanText(item, 80)).filter(Boolean);
    keywords[key] = Array.from(new Set([...keywords[key], ...clean])).slice(0, 20);
  }

  return keywords;
}

/**
 * JSON Schema for the extraction agent's structured output.
 *
 * Passed to the provider as a response schema, so the shape is enforced by the
 * decoder instead of merely requested in the prompt. Every field is `required`
 * and nullable rather than optional: providers that support strict mode demand a
 * closed object, and a null is what "the resume does not say" must look like.
 */
export function buildProfileResponseSchema() {
  const fieldSchema = (field) => {
    switch (field.type) {
      case "number":
        return { type: "number", nullable: true };
      case "tristate":
        return { type: "boolean", nullable: true };
      case "enum":
        return { type: "string", nullable: true, enum: field.options || [] };
      case "enum_or_text":
        return { type: "string", nullable: true };
      case "string_list":
        return { type: "array", items: { type: "string" } };
      case "years_map":
        return {
          type: "array",
          items: objectSchema({
            technology: { type: "string" },
            years: { type: "number" }
          })
        };
      case "record_list":
        return {
          type: "array",
          items: objectSchema(
            Object.fromEntries((field.item_fields || []).map((sub) => [sub.key, fieldSchema(sub)]))
          )
        };
      default:
        return { type: "string", nullable: true };
    }
  };

  const properties = {};
  for (const section of PROFILE_SECTIONS) {
    if (FLAT_SECTIONS.includes(section.key)) {
      properties[section.key] = objectSchema(
        Object.fromEntries(section.fields.map((field) => [field.key, fieldSchema(field)]))
      );
    } else {
      for (const field of section.fields) properties[field.key] = fieldSchema(field);
    }
  }

  return objectSchema({
    profile: objectSchema(properties),
    warnings: { type: "array", items: { type: "string" } }
  });
}

function objectSchema(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    propertyOrdering: Object.keys(properties),
    additionalProperties: false
  };
}

/** Fields the onboarding needs before the agents can be trusted to act. */
export function profileCompleteness(profile) {
  const missing = [];
  for (const section of PROFILE_SECTIONS) {
    if (!FLAT_SECTIONS.includes(section.key)) continue;
    for (const field of section.fields) {
      if (!field.required) continue;
      const value = profile?.[section.key]?.[field.key];
      if (value === null || value === undefined || value === "") missing.push(`${section.key}.${field.key}`);
    }
  }
  return { complete: missing.length === 0, missing };
}

/**
 * Merges the database profile over the file-based `profile.json`, so existing
 * installs keep working and the interface becomes the authoritative editor.
 */
export function mergeProfiles(fileProfile = {}, dbProfile = null) {
  if (!dbProfile) return fileProfile;
  const merged = { ...fileProfile };
  for (const section of PROFILE_SECTIONS) {
    if (FLAT_SECTIONS.includes(section.key)) {
      merged[section.key] = { ...(fileProfile?.[section.key] || {}) };
      for (const field of section.fields) {
        const value = dbProfile?.[section.key]?.[field.key];
        if (!isEmptyValue(value)) merged[section.key][field.key] = value;
      }
      if (section.key === "demographics") {
        const keywords = dbProfile?.demographics?.option_keywords;
        if (keywords && Object.values(keywords).some((list) => (list || []).length)) {
          merged.demographics.option_keywords = keywords;
        }
      }
    } else {
      for (const field of section.fields) {
        const value = dbProfile?.[field.key];
        if (!isEmptyValue(value)) merged[field.key] = value;
      }
    }
  }
  return merged;
}

function isEmptyValue(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Compact, model-facing view of the trusted profile. */
export function profileFactsForModel(profile, resumeText = "") {
  return {
    identity: {
      full_name: profile?.identity?.full_name || "",
      city: profile?.identity?.city || "",
      country: profile?.identity?.country || ""
    },
    professional: profile?.professional || {},
    work_eligibility: profile?.work_eligibility || {},
    declared_demographics: declaredDemographics(profile),
    years_by_technology: profile?.years_by_technology || {},
    recent_experiences: (profile?.recent_experiences || []).slice(0, 6),
    education: (profile?.education || []).slice(0, 4),
    resume_text: String(resumeText || "").slice(0, 12000)
  };
}

/**
 * Only values the user explicitly declared. Anything left blank is reported as
 * "nao_declarado" so a model can never read silence as an affirmative answer.
 */
export function declaredDemographics(profile) {
  const demographics = profile?.demographics || {};
  const describe = (value) => (value === true ? "sim" : value === false ? "nao" : "nao_declarado");
  return {
    pcd: describe(demographics.has_disability),
    veterano: describe(demographics.is_veteran),
    genero: demographics.gender || "nao_declarado",
    identidade_de_genero: demographics.gender_identity || "nao_declarado",
    raca_etnia: demographics.race_ethnicity || "nao_declarado",
    orientacao_sexual: demographics.sexual_orientation || "nao_declarado"
  };
}
