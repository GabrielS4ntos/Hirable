#!/usr/bin/env node
/**
 * Restarts the local service.
 *
 * This exists so the auto-fix agent has exactly one way to restart, instead of
 * being handed `docker`, `launchctl` or `kill` — none of which it can reach
 * inside the sandbox. It asks the running server to exit; whatever supervises
 * the process (Docker's restart policy, launchd's KeepAlive, a shell loop)
 * brings it back up.
 *
 * When nothing supervises the process, restarting would mean stopping the app
 * for good. In that case the server refuses and this prints what happened, so
 * the agent can report it instead of silently taking the service down.
 */

const port = Number(process.env.WEB_PORT || 4321);
const url = `http://127.0.0.1:${port}/api/service/restart`;

try {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => ({}));

  if (response.ok) {
    console.log(JSON.stringify({ status: "restarting", supervisor: body.supervisor, detail: body.detail }, null, 2));
    process.exit(0);
  }

  console.error(JSON.stringify({ status: "refused", code: body.code, detail: body.error }, null, 2));
  process.exit(1);
} catch (error) {
  console.error(JSON.stringify({
    status: "unreachable",
    detail: `nenhum servidor respondendo em ${url}: ${error.message}`
  }, null, 2));
  process.exit(1);
}
