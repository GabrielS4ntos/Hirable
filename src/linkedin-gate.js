/**
 * Every pipeline drives a logged-in LinkedIn session, so none of them can do
 * anything useful without one.
 *
 * Unlike the profile gate, this one does not park the schedules: a session
 * expires on LinkedIn's terms, often, and clearing every `next_run_at` each
 * time would turn a transient state into a configuration mess. The run is
 * refused instead, and the schedule stays armed for when the session returns.
 */

export const LINKEDIN_GATE_CODE = "linkedin_disconnected";

export const LINKEDIN_GATE_MESSAGE =
  "Sessão do LinkedIn não conectada: conecte pela interface antes de executar os pipelines";

export const LINKEDIN_EXPIRED_MESSAGE =
  "A sessão do LinkedIn expirou: reconecte pela interface para retomar os pipelines";

/**
 * @param {{state?: string}|null} session  record stored in app_settings
 * @returns {{ready: boolean, state: string, code: string|null, reason: string|null}}
 */
export function evaluateLinkedInGate(session) {
  const state = session?.state || "disconnected";
  if (state === "connected") return { ready: true, state, code: null, reason: null };

  return {
    ready: false,
    state,
    code: LINKEDIN_GATE_CODE,
    reason: state === "expired" ? LINKEDIN_EXPIRED_MESSAGE : LINKEDIN_GATE_MESSAGE
  };
}

export function linkedInGateError(gate) {
  const error = new Error(gate?.reason || LINKEDIN_GATE_MESSAGE);
  error.code = LINKEDIN_GATE_CODE;
  return error;
}
