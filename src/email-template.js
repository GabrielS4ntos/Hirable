/**
 * HTML (plus plain-text) rendering for the notification emails.
 *
 * Every value that reaches the template comes from a failure — a stack trace, a
 * LinkedIn page title, a model response — so nothing is interpolated without
 * escaping. Styles are inline because mail clients drop <style> blocks, and the
 * layout is a single table for the same reason.
 */

const PALETTE = {
  error: { accent: "#dc2626", label: "Erro" },
  warning: { accent: "#d97706", label: "Atenção" },
  info: { accent: "#2563eb", label: "Informação" },
  success: { accent: "#059669", label: "Concluído" }
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tone(level) {
  return PALETTE[level] || PALETTE.info;
}

function metaRow(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<tr>
      <td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:6px 0;color:#0f172a;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(value)}</td>
    </tr>`;
}

/**
 * Renders one alert.
 *
 * @param {object} alert
 * @param {"error"|"warning"|"info"|"success"} alert.level
 * @param {number} [alert.suppressed]  identical alerts silenced since the last email
 * @param {{status: string, agent: string, detail: string}|null} [alert.autoFix]
 * @returns {{subject: string, text: string, html: string}}
 */
export function renderAlertEmail({
  title = "LinkedIn Local Agent",
  level = "error",
  command = "",
  status = "",
  message = "",
  occurredAt = new Date().toISOString(),
  firstSeenAt = null,
  occurrences = 1,
  suppressed = 0,
  windowMinutes = 0,
  autoFix = null,
  consoleUrl = "http://127.0.0.1:4321"
} = {}) {
  const { accent, label } = tone(level);
  const heading = command ? `${label}: ${command}` : label;
  const subject = `[${title}] ${status || label}${command ? ` · ${command}` : ""}`;

  const suppressedNote = suppressed > 0
    ? `${suppressed} ocorrência(s) idêntica(s) foram agrupadas desde o último aviso.`
    : "";
  const windowNote = windowMinutes > 0
    ? `Avisos repetidos deste mesmo erro ficam silenciados por ${windowMinutes} minuto(s).`
    : "";

  const text = [
    `${heading}`,
    status ? `Status: ${status}` : "",
    `Quando: ${occurredAt}`,
    firstSeenAt && firstSeenAt !== occurredAt ? `Primeira ocorrência: ${firstSeenAt}` : "",
    occurrences > 1 ? `Ocorrências no total: ${occurrences}` : "",
    suppressedNote,
    "",
    message,
    "",
    autoFix ? `Auto-fix (${autoFix.agent}): ${autoFix.status}${autoFix.detail ? ` — ${autoFix.detail}` : ""}` : "",
    windowNote,
    consoleUrl
  ].filter(Boolean).join("\n");

  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="height:4px;background:${accent}"></td></tr>
    <tr><td style="padding:20px 24px 8px">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:700">${escapeHtml(label)}</p>
      <h1 style="margin:0;font-size:18px;line-height:1.35;color:#0f172a">${escapeHtml(heading)}</h1>
    </td></tr>
    <tr><td style="padding:8px 24px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">
        ${metaRow("Status", status)}
        ${metaRow("Quando", occurredAt)}
        ${firstSeenAt && firstSeenAt !== occurredAt ? metaRow("Primeira ocorrência", firstSeenAt) : ""}
        ${occurrences > 1 ? metaRow("Ocorrências", String(occurrences)) : ""}
      </table>
    </td></tr>
    <tr><td style="padding:16px 24px 0">
      <pre style="margin:0;padding:14px;background:#0f172a;color:#e2e8f0;border-radius:8px;font-size:12px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word">${escapeHtml(message)}</pre>
    </td></tr>
    ${suppressedNote ? `<tr><td style="padding:14px 24px 0">
      <p style="margin:0;padding:10px 12px;background:#fef3c7;border-radius:8px;color:#78350f;font-size:13px">${escapeHtml(suppressedNote)}</p>
    </td></tr>` : ""}
    ${autoFix ? `<tr><td style="padding:14px 24px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px">
        <tr><td style="padding:12px 14px">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#0f172a">Auto-fix · ${escapeHtml(autoFix.agent || "")}</p>
          <p style="margin:0;font-size:13px;color:#334155">${escapeHtml(autoFix.status || "")}${autoFix.detail ? ` — ${escapeHtml(autoFix.detail)}` : ""}</p>
        </td></tr>
      </table>
    </td></tr>` : ""}
    <tr><td style="padding:18px 24px 22px">
      <a href="${escapeHtml(consoleUrl)}" style="display:inline-block;padding:9px 16px;background:#0f172a;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Abrir o console</a>
      ${windowNote ? `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">${escapeHtml(windowNote)}</p>` : ""}
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
