/**
 * Reading a provider's failure well enough to decide what to do next.
 *
 * The distinction that matters is whether the failure belongs to *this key* or
 * to the request. A quota error and an invalid key are both key-scoped: another
 * key may work, so the rotation should move on instead of giving up on the
 * provider. A bad model name or a malformed prompt is not — retrying it on
 * every key just burns the same error N times.
 */

/** The provider's own message, dug out of whatever shape it arrived in. */
export function modelErrorText(error) {
  if (!error) return "";
  // `String(new Error(""))` is the literal "Error", which is worse than nothing:
  // it reads like a message and says less.
  const raw = typeof error === "string" ? error : String(error.message ?? "").trim();
  if (!raw) return "";

  // Google returns the failure as a JSON document in `message`.
  const start = raw.indexOf("{");
  if (start !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(start));
      const inner = parsed?.error?.message || parsed?.message;
      if (inner) return String(inner);
    } catch {}
  }
  return raw;
}

/**
 * Everything a classifier should look at: the unwrapped message *and* the raw
 * text around it. A status code often sits in the wrapper — "OpenRouter 401:
 * {…}" — and unwrapping to the inner message alone throws it away.
 */
function haystack(error) {
  const raw = typeof error === "string" ? error : String(error?.message ?? "");
  return `${modelErrorText(error)} ${raw} ${error?.code ?? ""} ${error?.status ?? ""}`.toLowerCase();
}

/** A key that the provider refuses: wrong, revoked, expired or unauthorised. */
export function isInvalidKeyError(error) {
  return /api[_ ]?key[_ ]?invalid|api key not valid|invalid[_ ]api[_ ]key|unauthenticated|invalid authentication|incorrect api key|permission_denied|user not found|no auth credentials|\b401\b|\b403\b/.test(
    haystack(error)
  );
}

/** Out of quota or being rate limited. Another key of the same provider may not be. */
export function isQuotaError(error) {
  return /429|quota|rate limit|resource_exhausted|too many|exceeded/.test(haystack(error));
}

/**
 * Whether to try the provider's next key.
 *
 * Both quota and credential failures qualify: they say something about the key
 * that was used, not about what was asked. Everything else fails fast.
 */
export function isKeyScopedModelError(error) {
  return isQuotaError(error) || isInvalidKeyError(error);
}

/**
 * A sentence a person can act on, instead of a provider's JSON.
 *
 * @param {{provider?: string, keyLabel?: string}} context
 */
export function describeModelError(error, { provider = "", keyLabel = "" } = {}) {
  const where = [provider, keyLabel].filter(Boolean).join(" · ");
  if (isInvalidKeyError(error)) {
    return where
      ? `Chave de API recusada (${where}). Verifique a chave em Chaves de API.`
      : "Chave de API recusada. Verifique a chave em Chaves de API.";
  }
  if (isQuotaError(error)) {
    return where ? `Cota ou limite atingido (${where}).` : "Cota ou limite atingido.";
  }
  const text = modelErrorText(error).replace(/\s+/g, " ").trim();
  return (where ? `${where}: ` : "") + (text.slice(0, 300) || "falha desconhecida no provider");
}
