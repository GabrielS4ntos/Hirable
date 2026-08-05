import fs from "node:fs";
import path from "node:path";

/**
 * Containment for the auto-fix agent.
 *
 * The agent is a separate program with its own tool loop, so this module cannot
 * approve each action it takes from the inside. What it does instead is remove
 * the ability: the process is started with a PATH containing nothing but an
 * allowlist of binaries, so a command that is not on the list does not exist as
 * far as that process is concerned. That is enforcement, not advice.
 *
 * Layers, strongest first:
 *   1. PATH restricted to a generated bin directory (this file)
 *   2. the CLI's own permission flags (cli-agents.js)
 *   3. the instruction text (auto-fix.js)
 * Layer 1 is what holds when the other two are ignored.
 */

/**
 * Binaries the agent may call, by purpose.
 *
 * Read-only inspection plus the project's own scripts. Deliberately absent:
 * git in any form, package installation, permission changes, process control,
 * and anything that reaches the network.
 */
export const ALLOWED_BINARIES = Object.freeze({
  // Reading and searching the repository.
  read: ["cat", "head", "tail", "ls", "find", "grep", "rg", "wc", "stat", "file", "sort", "uniq", "cut", "sed", "awk", "diff", "pwd", "echo", "which", "date", "jq"],
  // Running the project: tests, type-check, build, and the restart script.
  run: ["node", "npm", "npx"]
});

export const ALLOWED_BINARY_LIST = Object.freeze([...ALLOWED_BINARIES.read, ...ALLOWED_BINARIES.run]);

/**
 * npm/npx can run anything, so the allowlist continues at the script level.
 * These are the only npm scripts the instruction offers, and the only ones the
 * agent has a reason to use.
 */
export const ALLOWED_NPM_SCRIPTS = Object.freeze(["test", "validate", "web:build", "service:restart", "storage:status"]);

/**
 * Command lines that are refused before launch, as a second opinion on the
 * PATH restriction: an absolute path such as /usr/bin/git ignores PATH entirely.
 */
const BLOCKED_COMMAND_PATTERNS = [
  { pattern: /(^|\s|\/)git(\s|$)/i, reason: "interacao_com_git" },
  { pattern: /(^|\s|\/)(rm|rmdir|unlink|mv)(\s|$)/i, reason: "remocao_de_arquivos" },
  { pattern: /(^|\s|\/)(dd|mkfs|fdisk|diskutil)(\s|$)/i, reason: "operacao_de_disco" },
  { pattern: /(^|\s|\/)(shutdown|reboot|halt|kill|killall|pkill)(\s|$)/i, reason: "controle_de_processos" },
  { pattern: /(^|\s|\/)(sudo|doas|su)(\s|$)/i, reason: "escalonamento_de_privilegio" },
  { pattern: /(^|\s|\/)(chmod|chown)(\s|$)/i, reason: "alteracao_de_permissoes" },
  { pattern: /(^|\s|\/)(curl|wget)\b/i, reason: "acesso_a_rede" },
  { pattern: /(^|\s|\/)npm\s+(publish|unpublish|login|token|install|i|add)(\s|$)/i, reason: "instalacao_ou_publicacao" },
  { pattern: /(^|\s|\/)(launchctl|systemctl|crontab|docker)(\s|$)/i, reason: "alteracao_de_servico" },
  { pattern: />\s*\/dev\/(sd|disk)/i, reason: "escrita_em_dispositivo" }
];

/** Environment variables the agent has no reason to read. */
const SECRET_ENV_PATTERN = /^(GEMINI|OPENROUTER|LINKEDIN|GOOGLE|GMAIL)\w*(KEY|KEYS|SECRET|TOKEN|PASSWORD|CREDENTIALS)$/i;

/**
 * Ours by name, so they cannot be inferred from the pattern above.
 *
 * Note the plural: `OPENAI_API_KEYS` is this app's model-provider variable and
 * is removed, while the singular `OPENAI_API_KEY` is what the Codex CLI itself
 * authenticates with and is deliberately left in place.
 */
const SECRET_ENV_EXACT = new Set(["OPENAI_API_KEYS"]);

export function inspectCommandLine(commandLine) {
  const text = String(commandLine || "");
  for (const { pattern, reason } of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(text)) return { blocked: true, reason };
  }
  return { blocked: false, reason: null };
}

/**
 * True when `candidate` resolves inside `root`.
 *
 * Symlinks are resolved first: a link inside the repository pointing at `/etc`
 * would otherwise pass a purely textual check.
 */
export function isInsideRepo(candidate, root) {
  const realRoot = realPathOrSelf(path.resolve(root));
  const target = realPathOrSelf(path.resolve(realRoot, String(candidate || "")));
  if (target === realRoot) return true;
  const relative = path.relative(realRoot, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function realPathOrSelf(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    const parent = path.dirname(target);
    if (parent === target) return target;
    return path.join(realPathOrSelf(parent), path.basename(target));
  }
}

/**
 * Builds the restricted bin directory and returns its path.
 *
 * Each allowed binary found on the caller's PATH gets one symlink; everything
 * else becomes "command not found" for the agent. The directory is rebuilt on
 * every run so a stale link cannot widen the allowlist.
 */
export function prepareSandboxBin(root, { sourcePath = process.env.PATH || "", binaries = ALLOWED_BINARY_LIST } = {}) {
  const binDir = path.join(root, ".autofix-bin");
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });

  const linked = [];
  for (const binary of binaries) {
    const resolved = resolveBinary(binary, sourcePath);
    if (!resolved) continue;
    try {
      fs.symlinkSync(resolved, path.join(binDir, binary));
      linked.push(binary);
    } catch {}
  }
  return { dir: binDir, linked };
}

function resolveBinary(name, sourcePath) {
  for (const directory of String(sourcePath).split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

/**
 * Environment for the agent process: the caller's environment minus this app's
 * secrets, with PATH replaced by the restricted bin directory when one is given.
 *
 * The agent's own credentials (ANTHROPIC_API_KEY, OPENAI_API_KEY…) are kept —
 * without them the CLI cannot authenticate at all.
 */
export function sandboxEnv(source = process.env, { binDir = null } = {}) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (SECRET_ENV_EXACT.has(key.toUpperCase()) || SECRET_ENV_PATTERN.test(key)) continue;
    env[key] = value;
  }
  if (binDir) env.PATH = binDir;
  env.LINKEDIN_AGENT_AUTOFIX = "1";
  return env;
}

/**
 * Validates a launch request. Throws with a user-facing reason, because every
 * refusal here is something the user has to see in the settings screen.
 *
 * `args` must be the *unsubstituted* template: the instruction we send names the
 * commands the agent may not use, and scanning the filled-in prompt would flag
 * our own warning as a blocked command.
 */
export function assertLaunchAllowed({ command, args = [], cwd, root }) {
  const commandLine = [command, ...args].join(" ");
  const verdict = inspectCommandLine(commandLine);
  if (verdict.blocked) {
    const error = new Error(`comando bloqueado pela sandbox: ${verdict.reason}`);
    error.code = "autofix_blocked_command";
    error.reason = verdict.reason;
    throw error;
  }
  if (!isInsideRepo(cwd, root)) {
    const error = new Error("a sandbox executa apenas dentro da pasta do repositório");
    error.code = "autofix_outside_workdir";
    throw error;
  }
  return true;
}

/**
 * Neutralizes untrusted text before it is placed in a prompt.
 *
 * The failure message can contain a LinkedIn page title, a form label or a model
 * response — none of it written by us. The structural risk is that it closes the
 * fence it sits in and continues as if it were part of the instruction, so the
 * fence markers are the thing that has to go.
 */
export function sanitizeUntrusted(text, { maxChars = 6000 } = {}) {
  return String(text ?? "")
    // Backticks cannot close the fence they are quoted inside.
    .replace(/`/g, "'")
    // Control characters, including the ANSI escapes a terminal error can carry.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maxChars);
}
