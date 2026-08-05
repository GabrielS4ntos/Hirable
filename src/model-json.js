/**
 * Tolerant parsing of JSON produced by a model.
 *
 * Providers can cut a response short on the token limit. Callers normalize the
 * result field by field, so recovering a partial object is strictly better than
 * discarding a whole extraction over a missing closing brace.
 */

export function parseModelJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) throw new Error("model returned an empty response");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const salvaged = salvageTruncatedJson(raw);
    if (salvaged) return salvaged;
    throw error;
  }
}

/** Closes the still-open brackets of a truncated document, dropping the partial tail. */
export function salvageTruncatedJson(raw) {
  const start = String(raw).indexOf("{");
  if (start === -1) return null;

  const stack = [];
  let inString = false;
  let escaped = false;
  let lastSafeEnd = -1;
  let lastSafeStack = null;

  for (let index = start; index < raw.length; index++) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.length) {
      // Record the cut point together with the bracket state that belongs to it:
      // closing with the final state would produce mismatched brackets.
      lastSafeEnd = index;
      lastSafeStack = stack.slice();
    }
  }

  if (!stack.length) return null;

  const close = (open) => open.slice().reverse().join("");
  const candidates = [];
  if (lastSafeEnd > start && lastSafeStack) candidates.push(raw.slice(start, lastSafeEnd) + close(lastSafeStack));
  candidates.push(raw.slice(start) + close(stack));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return null;
}
