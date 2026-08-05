/**
 * State of the LinkedIn session, and how it is recognized.
 *
 * The session itself lives where it has always lived: inside the persistent
 * Chromium profile. Nothing here copies it anywhere — the database only ever
 * learns whether a session exists, when it was established and under which
 * account name, which is what the interface needs to show a dot and a label.
 */

export const SESSION_STATES = ["connected", "disconnected", "pending", "expired"];

/** Cookie LinkedIn sets for an authenticated session. Only its presence is read. */
const SESSION_COOKIE = "li_at";

export function isLoginUrl(url, pattern = "linkedin.com/login|checkpoint|uas/login") {
  try {
    return new RegExp(pattern, "i").test(String(url || ""));
  } catch {
    return /linkedin\.com\/(login|checkpoint|uas\/login)/i.test(String(url || ""));
  }
}

/**
 * Two-step verification and other interstitials.
 *
 * These match the login pattern but mean "the user is in the middle of it",
 * which is the difference between waiting and giving up.
 */
export function isCheckpointUrl(url) {
  return /linkedin\.com\/checkpoint|\/uas\/consumer-email-challenge|challenge/i.test(String(url || ""));
}

/**
 * Decides whether a page belongs to a signed-in session.
 *
 * Two independent pieces of evidence are required, because either one alone
 * lies: the cookie can outlive an invalidated session, and a URL that did not
 * redirect can simply be a page that renders for anonymous visitors too.
 *
 * @param {{url: string, cookies?: {name: string}[], bodyText?: string, loginPattern?: string}} input
 * @returns {{connected: boolean, state: string, reason: string, account_name: string}}
 */
export function detectSession({ url = "", cookies = [], bodyText = "", loginPattern } = {}) {
  const hasCookie = (cookies || []).some((cookie) => cookie?.name === SESSION_COOKIE);
  const onLoginPage = isLoginUrl(url, loginPattern);

  if (onLoginPage) {
    return {
      connected: false,
      state: isCheckpointUrl(url) ? "pending" : "disconnected",
      reason: isCheckpointUrl(url) ? "verificacao_em_andamento" : "sessao_ausente",
      account_name: ""
    };
  }
  if (!hasCookie) {
    return { connected: false, state: "disconnected", reason: "cookie_de_sessao_ausente", account_name: "" };
  }

  return { connected: true, state: "connected", reason: "", account_name: readAccountName(bodyText) };
}

/**
 * Best-effort display name, for the interface to show whose account is attached.
 *
 * Absence is not a failure: the session is confirmed by the cookie and the URL,
 * so a layout change here costs a label, never a wrong verdict.
 */
export function readAccountName(bodyText = "") {
  // Joining whitespace excludes newlines on purpose: the greeting is one line,
  // and crossing into the next one swallows unrelated page text as a surname.
  const match = String(bodyText).match(/(?:Ol[áa]|Hi|Welcome,?)[,\t ]+([\p{L}][\p{L}'’.-]*(?:[\t ]+[\p{L}][\p{L}'’.-]*){0,3})/u);
  return match ? match[1].trim().slice(0, 80) : "";
}

/** Shape stored in `app_settings`, so every reader agrees on the fields. */
export function sessionRecord({ state, account_name = "", reason = "", at = new Date().toISOString() } = {}) {
  const normalized = SESSION_STATES.includes(state) ? state : "disconnected";
  return {
    state: normalized,
    account_name: String(account_name || "").slice(0, 80),
    last_reason: String(reason || "").slice(0, 200),
    connected_at: normalized === "connected" ? at : null,
    checked_at: at
  };
}
