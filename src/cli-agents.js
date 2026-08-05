/**
 * Coding-agent CLIs that can be handed a failure to fix.
 *
 * Same role model as the model providers in `providers.js` (primary, fallback,
 * none) and the same helpers decide the roles, so the two settings screens
 * behave identically. What differs is authentication: these CLIs carry their own
 * credentials, so this catalog never stores a key.
 *
 * `args_template` is editable per install on purpose. These tools ship new flags
 * often, and a wrong default here would be an unfixable dead end for the user;
 * with the template exposed, a changed flag is a text edit in the interface.
 * `{prompt}` is replaced by the instruction, `{file}` by the report path.
 */

export const CLI_AGENTS = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    // -p runs headless and prints the result. The deny list is the CLI's own
    // second layer; the restricted PATH is what actually removes the binaries.
    args_template: ["-p", "{prompt}", "--disallowedTools", "Bash(git:*),WebFetch,WebSearch"],
    docs_url: "https://docs.claude.com/en/docs/claude-code/cli-reference",
    install_hint: "npm i -g @anthropic-ai/claude-code"
  },
  {
    id: "codex",
    label: "OpenAI Codex CLI",
    command: "codex",
    args_template: ["exec", "--sandbox", "workspace-write", "{prompt}"],
    docs_url: "https://developers.openai.com/codex/cli",
    install_hint: "npm i -g @openai/codex"
  },
  {
    id: "opencode",
    label: "opencode",
    command: "opencode",
    args_template: ["run", "{prompt}"],
    docs_url: "https://opencode.ai/docs/cli",
    install_hint: "npm i -g opencode-ai"
  },
  {
    id: "agy",
    label: "Agy",
    command: "agy",
    args_template: ["run", "{prompt}"],
    docs_url: "",
    install_hint: "confira a documentação do Agy para o comando não interativo"
  }
];

export const CLI_AGENT_IDS = CLI_AGENTS.map((agent) => agent.id);

export function getCliAgent(id) {
  return CLI_AGENTS.find((agent) => agent.id === id) || null;
}

export function isCliAgent(id) {
  return CLI_AGENT_IDS.includes(String(id));
}

/**
 * Fills `{prompt}` and `{file}` in an argument template.
 *
 * Substitution is per argument and never re-splits: the prompt stays a single
 * argv entry, so no quoting or shell parsing is involved anywhere in this path.
 */
export function buildAgentArgs(template, { prompt = "", file = "" } = {}) {
  return (Array.isArray(template) ? template : [])
    .map((argument) =>
      String(argument)
        .replaceAll("{prompt}", prompt)
        .replaceAll("{file}", file)
    )
    .filter((argument) => argument.length > 0);
}

/** Parses a user-edited template. Accepts a JSON array or a whitespace-separated line. */
export function parseArgsTemplate(input, fallback = []) {
  if (Array.isArray(input)) return input.map((item) => String(item)).slice(0, 40);
  const text = String(input ?? "").trim();
  if (!text) return [...fallback];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).slice(0, 40);
    } catch {
      throw new Error("argumentos: JSON inválido");
    }
  }
  // Quoted segments stay together so `{prompt}` can sit next to other words.
  const matches = text.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((item) => item.replace(/^["']|["']$/g, "")).slice(0, 40);
}
