/**
 * Deterministic guard for vacancies restricted to a specific group.
 *
 * The résumé alone can never be trusted to say whether the candidate is a person
 * with a disability, a veteran, or part of an affirmative-action group. Without an
 * explicit declaration in the profile, the agent must not apply to a vacancy that
 * is exclusive to that group — so this runs before the model, not instead of it.
 *
 * Silence is never an affirmative answer: an undeclared field blocks the apply.
 */

/**
 * A vacancy only counts as restricted when a group term appears together with an
 * exclusivity marker. Plain diversity boilerplate ("pessoas com deficiencia sao
 * bem-vindas") must not block an otherwise open vacancy.
 */
const EXCLUSIVITY_MARKERS = [
  "exclusiv",
  "somente para",
  "apenas para",
  "destinada a",
  "destinado a",
  "reservada",
  "reservado",
  "vaga afirmativa",
  "vagas afirmativas",
  "programa afirmativo",
  "processo afirmativo",
  "only for",
  "only open to",
  "restricted to",
  "reserved for",
  "exclusively for",
  "must be a"
];

const GROUPS = [
  {
    id: "pcd",
    label: "pessoas com deficiência (PCD)",
    profileKey: "has_disability",
    terms: [
      "pcd",
      "pessoa com deficiencia",
      "pessoas com deficiencia",
      "candidatos com deficiencia",
      "profissionais com deficiencia",
      "with disabilities",
      "with a disability",
      "disability hiring",
      "pwd"
    ]
  },
  {
    id: "veterano",
    label: "veteranos",
    profileKey: "is_veteran",
    terms: ["veterano", "veteranos", "veteran", "veterans", "military veteran"]
  },
  {
    id: "mulheres",
    label: "mulheres",
    profileKey: "gender",
    expectedTextPattern: /(mulher|feminin|woman|women|female)/i,
    terms: ["mulheres", "mulher", "women", "female candidates", "feminino"]
  },
  {
    id: "pessoas_negras",
    label: "pessoas negras",
    profileKey: "race_ethnicity",
    expectedTextPattern: /(negr|preta|preto|parda|pardo|black|afro)/i,
    terms: ["pessoas negras", "pessoas pretas", "candidatos negros", "black professionals", "black talent", "afrodescendentes"]
  },
  {
    id: "lgbtqia",
    label: "pessoas LGBTQIA+",
    profileKey: "sexual_orientation",
    expectedTextPattern: /(lgbt|gay|lesb|bissex|bisexual|queer|trans)/i,
    terms: ["lgbt", "lgbtqia", "lgbtqia+", "lgbtq+", "comunidade lgbt"]
  }
];

const WINDOW = 120;

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Detects which restricted groups a job text targets. */
export function detectRestrictedGroups(text) {
  const normalized = normalize(text);
  if (!normalized) return [];

  const found = [];
  for (const group of GROUPS) {
    const termIndexes = [];
    for (const term of group.terms) {
      let from = 0;
      for (;;) {
        const index = normalized.indexOf(term, from);
        if (index === -1) break;
        // "pwd" and "pcd" are short enough to appear inside other words.
        const before = normalized[index - 1] || " ";
        const after = normalized[index + term.length] || " ";
        if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) {
          from = index + term.length;
          continue;
        }
        termIndexes.push(index);
        from = index + term.length;
      }
    }
    if (!termIndexes.length) continue;

    const restricted = termIndexes.some((index) => {
      const slice = normalized.slice(Math.max(0, index - WINDOW), index + WINDOW);
      return EXCLUSIVITY_MARKERS.some((marker) => slice.includes(marker));
    });
    if (restricted) found.push(group);
  }
  return found;
}

/**
 * Decides whether the candidate may apply to a job, given the declared profile.
 *
 * @returns {{ allowed: boolean, reason: string, groups: string[], declared: string|null }}
 */
export function checkJobEligibility(job, profile) {
  const text = [job?.title, job?.company, job?.location, job?.compact_text].filter(Boolean).join(" \n ");
  const groups = detectRestrictedGroups(text);
  if (!groups.length) return { allowed: true, reason: "", groups: [], declared: null };

  const demographics = profile?.demographics || {};
  const blocking = [];

  for (const group of groups) {
    const value = demographics[group.profileKey];

    if (group.profileKey === "has_disability" || group.profileKey === "is_veteran") {
      if (value === true) continue;
      blocking.push({
        group,
        declared: value === false ? "declarado_nao" : "nao_declarado"
      });
      continue;
    }

    // Free-text demographics (gender, race, orientation): the declared value must
    // plausibly match the group the vacancy is reserved for.
    const declaredText = String(value || "").trim();
    if (declaredText && group.expectedTextPattern?.test(normalize(declaredText))) continue;
    blocking.push({ group, declared: declaredText ? "declarado_diferente" : "nao_declarado" });
  }

  if (!blocking.length) {
    return {
      allowed: true,
      reason: `Vaga afirmativa para ${groups.map((group) => group.label).join(", ")}; perfil declara pertencer ao grupo.`,
      groups: groups.map((group) => group.id),
      declared: "declarado_sim"
    };
  }

  const labels = blocking.map((item) => item.group.label).join(", ");
  const anyUndeclared = blocking.some((item) => item.declared === "nao_declarado");
  const reason = anyUndeclared
    ? `Vaga exclusiva para ${labels}, mas o perfil não declara pertencer a esse grupo. Preencha os dados sensíveis no perfil para liberar este tipo de vaga.`
    : `Vaga exclusiva para ${labels} e o perfil declara não pertencer a esse grupo.`;

  return {
    allowed: false,
    reason,
    groups: blocking.map((item) => item.group.id),
    declared: anyUndeclared ? "nao_declarado" : "declarado_nao"
  };
}
