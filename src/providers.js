/**
 * Model providers the agent can talk to.
 *
 * Roles decide routing, not the provider itself:
 *   primary   every model call goes here first
 *   fallback  used when the primary fails with a quota/rate error
 *   none      configured but idle
 *
 * Exactly one primary and at most one fallback exist at any time.
 */

export const PROVIDERS = [
  {
    id: "gemini",
    label: "Google Gemini",
    docs_url: "https://aistudio.google.com/apikey",
    key_hint: "AIza…",
    // Several keys can be registered and are consumed round-robin.
    supports_multiple_keys: true,
    models: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.5-pro"],
    default_model: "gemini-3.5-flash-lite"
  },
  {
    id: "openai",
    label: "OpenAI",
    docs_url: "https://platform.openai.com/api-keys",
    key_hint: "sk-proj-…",
    supports_multiple_keys: true,
    models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"],
    default_model: "gpt-5.6-terra"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    docs_url: "https://openrouter.ai/keys",
    key_hint: "sk-or-…",
    supports_multiple_keys: true,
    models: ["google/gemini-3.5-flash-lite", "openai/gpt-5.2-mini", "anthropic/claude-haiku-4.5"],
    default_model: "google/gemini-3.5-flash-lite"
  }
];

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);
export const ROLES = ["primary", "fallback", "none"];

export function getProvider(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}

export function isProvider(id) {
  return PROVIDER_IDS.includes(String(id));
}

/**
 * Applies a role change and returns the resulting role for every provider.
 *
 * The rule the interface exposes: with exactly two configured providers, naming
 * one primary makes the other the fallback automatically — a third one stays
 * idle until the user gives it a role explicitly.
 *
 * @param {{provider: string, role: string, configured: boolean}[]} current
 * @param {string} provider  the provider being changed
 * @param {string} role      the role it should take
 * @returns {Record<string, string>} provider -> role
 */
export function applyRoleChange(current, provider, role) {
  const roles = {};
  for (const item of current) roles[item.provider] = item.role || "none";

  const configured = current.filter((item) => item.configured).map((item) => item.provider);
  roles[provider] = role;

  if (role === "primary") {
    // Only one primary; a displaced primary is demoted, not deleted.
    for (const other of Object.keys(roles)) {
      if (other !== provider && roles[other] === "primary") roles[other] = "none";
    }
  }
  if (role === "fallback") {
    for (const other of Object.keys(roles)) {
      if (other !== provider && roles[other] === "fallback") roles[other] = "none";
    }
    // A provider cannot be its own fallback.
    if (roles[provider] === "fallback" && !Object.values(roles).includes("primary")) {
      const candidate = configured.find((item) => item !== provider);
      if (candidate) roles[candidate] = "primary";
    }
  }

  // With exactly two configured providers the pair is unambiguous.
  if (configured.length === 2) {
    const primary = configured.find((item) => roles[item] === "primary");
    if (primary) {
      const other = configured.find((item) => item !== primary);
      if (other && roles[other] !== "fallback") roles[other] = "fallback";
    }
  }

  // Never leave the agent without a primary while a configured provider exists.
  if (!Object.values(roles).includes("primary") && configured.length) {
    roles[configured[0]] = "primary";
    if (configured.length === 2 && roles[configured[1]] !== "primary") roles[configured[1]] = "fallback";
  }

  // An unconfigured provider cannot hold a role.
  for (const id of Object.keys(roles)) {
    if (!configured.includes(id)) roles[id] = "none";
  }
  return roles;
}

/** Roles after a provider gained its first key. */
export function rolesAfterConfiguring(current, provider, { makePrimary = false } = {}) {
  const configured = current.filter((item) => item.configured).map((item) => item.provider);
  const hasPrimary = current.some((item) => item.role === "primary" && item.configured);

  // The first provider ever configured is necessarily the primary.
  if (!hasPrimary || makePrimary) return applyRoleChange(current, provider, "primary");
  if (configured.length <= 2) return applyRoleChange(current, provider, "fallback");
  return applyRoleChange(current, provider, "none");
}
