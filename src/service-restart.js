import fs from "node:fs";

/**
 * Whether something will bring the process back after it exits.
 *
 * Restarting is only a restart when a supervisor is watching. Without one,
 * exiting is just stopping — so this is checked before the server agrees to go
 * down, and the caller is told exactly why when it refuses.
 */
export function detectSupervisor(env = process.env, { dockerEnvPath = "/.dockerenv" } = {}) {
  // Set by compose.yaml and by the launchd plists shipped in launchd/.
  if (env.AGENT_SUPERVISED === "1") return { supervised: true, kind: "declarado" };
  try {
    if (fs.existsSync(dockerEnvPath)) return { supervised: true, kind: "docker" };
  } catch {}
  if (env.container) return { supervised: true, kind: "container" };
  if (String(env.XPC_SERVICE_NAME || "").includes("linkedin")) return { supervised: true, kind: "launchd" };
  return {
    supervised: false,
    kind: "nenhum",
    reason: "nenhum supervisor detectado: sair encerraria o serviço em vez de reiniciá-lo"
  };
}
