import { normalizeProfile, profileCompleteness } from "./profile-schema.js";

/** Refusal code shared by the scheduler, the HTTP API and the CLI. */
export const PROFILE_GATE_CODE = "profile_incomplete";

export const PROFILE_GATE_MESSAGE =
  "Perfil incompleto: preencha e salve o perfil na interface antes de ativar ou executar pipelines";

/**
 * The agents act on the user's behalf using the profile as their only trusted
 * source of facts (PCD status, eligibility, contact data). Running a pipeline
 * with an incomplete profile means acting on guesses, so this gate is checked
 * everywhere a pipeline can start: the scheduler, the API and the CLI.
 */
export function evaluateProfileGate(profile, { onboardingComplete = false } = {}) {
  // Readiness is decided by the data itself, not by the onboarding flag: an
  // onboarding flag by itself is not enough to trust an incomplete profile.
  const { complete, missing } = profileCompleteness(profile);
  return {
    ready: complete,
    code: complete ? null : PROFILE_GATE_CODE,
    reason: complete ? null : PROFILE_GATE_MESSAGE,
    missing,
    onboarding_complete: Boolean(onboardingComplete)
  };
}

// Keyed by store instance: two stores (a test database and the real one) must
// never share a cached verdict.
let cache = new WeakMap();

/**
 * Resolves the gate from the profile stored in SQLite.
 *
 * The scheduler tick and the status poll both call this, so the result is
 * memoized until either source changes.
 */
export function profileGateState(store) {
  let stored;
  try {
    stored = store.getUserProfile();
  } catch {
    return evaluateProfileGate({}, { onboardingComplete: false });
  }

  const key = stored.updated_at || "never";
  const cached = cache.get(store);
  if (cached?.key === key) return cached.value;

  const profile = normalizeProfile(stored.profile || null);
  const value = evaluateProfileGate(profile, { onboardingComplete: stored.onboarding_complete });
  cache.set(store, { key, value });
  return value;
}

/** Drops the memoized gate. Used by tests and after a profile write. */
export function resetProfileGateCache() {
  cache = new WeakMap();
}

export function profileGateError(gate) {
  const error = new Error(gate?.reason || PROFILE_GATE_MESSAGE);
  error.code = PROFILE_GATE_CODE;
  error.missing = gate?.missing || [];
  return error;
}
