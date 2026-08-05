/**
 * Easy Apply and the job digest both put a résumé in front of a recruiter, so
 * neither may run when the database holds none.
 *
 * Without a stored file the pipeline has only two possible behaviours, and both
 * are wrong: submit with whatever LinkedIn happens to have preselected — which
 * is the most recent upload, not necessarily the right document — or email a
 * job alert that promises an attachment it cannot produce. Refusing is the only
 * honest option, and it is one upload away from being resolved.
 */

export const RESUME_GATE_CODE = "no_resume";

export const RESUME_GATE_MESSAGE =
  "Nenhum currículo cadastrado: envie ao menos um arquivo no perfil antes de se candidatar";

/**
 * @param {{id: string}[]} resumes  documents currently stored
 * @returns {{ready: boolean, code: string|null, reason: string|null, count: number}}
 */
export function evaluateResumeGate(resumes = []) {
  const count = Array.isArray(resumes) ? resumes.length : 0;
  return {
    ready: count > 0,
    code: count > 0 ? null : RESUME_GATE_CODE,
    reason: count > 0 ? null : RESUME_GATE_MESSAGE,
    count
  };
}

export function resumeGateError(gate) {
  const error = new Error(gate?.reason || RESUME_GATE_MESSAGE);
  error.code = RESUME_GATE_CODE;
  return error;
}
