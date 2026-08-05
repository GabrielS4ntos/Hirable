import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeProfiles, normalizeProfile, profileCompleteness } from "./profile-schema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  // install that only ever had a complete `profile.json` is just as trustworthy
  // as one filled through the interface.
  const { complete, missing } = profileCompleteness(profile);
  return {
    ready: complete,
    code: complete ? null : PROFILE_GATE_CODE,
    reason: complete ? null : PROFILE_GATE_MESSAGE,
    missing,
    onboarding_complete: Boolean(onboardingComplete)
  };
}

function readFileProfile(profilePath) {
  try {
    return JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch {
    return null;
  }
}

function fileStamp(profilePath) {
  try {
    return String(fs.statSync(profilePath).mtimeMs);
  } catch {
    return "none";
  }
}

// Keyed by store instance: two stores (a test database and the real one) must
// never share a cached verdict.
let cache = new WeakMap();

/**
 * Resolves the gate from the database profile merged over the legacy
 * `profile.json`, matching what `loadProfile` hands to the agents.
 *
 * The scheduler tick and the status poll both call this, so the result is
 * memoized until either source changes.
 */
export function profileGateState(store, config = null) {
  const profilePath = path.resolve(ROOT, config?.profile_path || "./profile.json");
  let stored;
  try {
    stored = store.getUserProfile();
  } catch {
    return evaluateProfileGate({}, { onboardingComplete: false });
  }

  const key = `${stored.updated_at || "never"}|${fileStamp(profilePath)}`;
  const cached = cache.get(store);
  if (cached?.key === key) return cached.value;

  const merged = normalizeProfile(mergeProfiles(readFileProfile(profilePath) || {}, stored.profile || null));
  const value = evaluateProfileGate(merged, { onboardingComplete: stored.onboarding_complete });
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
