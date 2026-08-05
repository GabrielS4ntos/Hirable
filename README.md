# LinkedIn local agent

Local script layer for LinkedIn automation.

Current stage:

- Open LinkedIn with a persistent local browser profile.
- Read the messaging list through the DOM.
- Produce compact JSON only.
- Compare the result with the operational state stored in local SQLite.
- Exit without calling any model when there is no new inbound DM signal.
- Do not trigger the model when the last visible message is from the profile owner (`Voce:`, `Você:`, or `You:`).
- When opening a conversation, check the last extracted sender before normalizing/filtering dates.
- Never send messages in this stage.

Commands:

```bash
npm run dm:check
npm run dm:check:headed
npm run dm:check:headless
npm run dm:debug
npm run dm:mock
npm run network:accept
npm run jobs:scan
npm run jobs:apply
npm run jobs:apply-one -- <record_id|job_id>
npm run jobs:form-smoke -- 'https://www.linkedin.com/jobs/view/<id>/apply/?openSDUIApplyFlow=true'
npm run semantic:mock
npm run semantic:smoke
npm run gmail:auth
npm run gmail:test
npm run validate
npm run storage:status
npm test
npm run web
npm run web:install
npm run web:build
npm run web:dev
```

First run:

1. Copy `config.example.json` to the ignored local file `config.json`.
2. Copy `profile.example.json` to the ignored local file `profile.json` and fill it with trusted facts only.
3. Copy `secrets.env.example` to `secrets/.env` and provide model keys.
4. Run `npm install` and `npx playwright install chromium`.
5. Run `npm run dm:check:headed` and log in to LinkedIn if needed.
6. Run `npm run dm:check:headless` after the messaging page loads.

The browser profile is stored in `.browser-profile` under this folder.

## Web console

A local React interface reads and writes the same SQLite database the pipelines use.

```bash
npm run web:install   # once, installs the interface dependencies under web/
npm run web:build     # compiles web/dist
npm run web           # serves http://127.0.0.1:4321 and starts the scheduler
```

For interface development run `npm run web` in one terminal and `npm run web:dev` in
another; the Vite dev server on port 4322 proxies `/api` to the agent server.

The server binds to `127.0.0.1` only and rejects cross-origin browsers. It is a local
control panel, not a service to expose on a network.

Screens:

- **Painel** — counters, per-pipeline status, "Executar agora" and run history.
- **Vagas analisadas** — every analyzed item in one table with an **Enviar** button.
- **Configurações** — scheduling mode and schedule per pipeline.
- **Chaves de API** — Gemini and OpenRouter keys.

### API keys

Keys are stored in the `api_keys` table of the local SQLite file (`chmod 600`). Several
Gemini keys can be registered and are consumed in round-robin; the OpenRouter key is the
fallback used when every Gemini key fails with a quota error. A key can be disabled
without deleting it, and the interface only ever shows a masked value.

Database keys take precedence over `secrets/.env`. When no key is registered the agent
falls back to `GEMINI_API_KEYS`/`GEMINI_API_KEY` and `OPENROUTER_API_KEY` as before, so
existing setups keep working.

### Pipeline scheduling

Each pipeline (`dm`, `network`, `jobs`) has a row in `pipeline_schedules` with:

- **mode** — `auto` (the scheduler runs it), `manual` (only from the interface) or `off`
  (never runs, which is how you take a pipeline out of the automatic rotation).
- **schedule_kind** — `cron` (you write the expression), `interval` (every N minutes) or
  `daily_times` (a list of `HH:MM`).
- **weekdays**, **window_start**/**window_end** — an extra filter applied on top of the
  schedule, so a frequent cron still never fires outside working hours.
- **jitter_seconds** — random delay before an automatic run.

Cron accepts the standard 5 fields (`minuto hora dia mês dia-da-semana`) with `*`, ranges,
lists, `/steps`, month/weekday names and `@daily`-style presets. The settings screen
validates the expression while you type and previews the next five executions.

The scheduler lives inside `npm run web`. It ticks every 30s, runs at most one pipeline at
a time (they share one Chromium profile), and records every execution in `pipeline_runs`.
Keep the server running — for example through a single launchd plist — for automatic mode
to work.

### Standardized agent records

All pipelines normalize their agent output into one shape (`src/agent-record.js`) stored in
`agent_records`, so jobs, DMs and invitations share the same table and columns in the
interface: `title`, `subtitle`, `location`, `score`, `decision`, `confidence`, `risk_flags`,
`reason`, `status`, `send_method` and `send_state`.

`send_state` is what drives the **Enviar** button:

| state | button | meaning |
| --- | --- | --- |
| `available` | enabled | analyzed and ready for a manual send |
| `failed` | enabled | a previous send failed, retry is allowed |
| `in_progress` | disabled | a send is running right now |
| `sent_auto` | disabled | already applied by the automatic pipeline |
| `sent_manual` | disabled | already applied from this interface |
| `unsupported` | disabled | no automatic send method (job without Easy Apply) |
| `blocked` | disabled | the agent or the safety rules refuse the send |

Hovering a disabled button shows the exact reason. A rescan never downgrades a record that
was already sent, so an application cannot be submitted twice.

Manual sends run `jobs:apply-one`, which reuses the same Easy Apply flow, semantic memory
and safety gates as the automatic pipeline, and respects the daily/weekly caps in
`config.json`.

Local scheduling:

- `launchd/com.example.linkedin-web-console.plist.example` keeps `npm run web` alive. With
  the console running, all scheduling is managed in the interface and the per-pipeline
  plists below are no longer needed.
- Generic launchd examples are available in `launchd/*.plist.example`.
- Replace `__PROJECT_DIR__` with the absolute project directory and choose unique labels before loading them.
- Local, machine-specific plists must not be committed.

Pipeline coordination:

- All scripts use the same Playwright Chromium profile in `.browser-profile`.
- A lock file prevents two pipelines from opening Chromium at the same time.
- Keep DMs frequent, invitations slightly offset, and jobs at fixed low-frequency slots.
- `jobs:scan` extracts jobs and the scheduled jobs pipeline can run Easy Apply when enabled in `config.json`.
- `jobs:form-smoke` opens exactly one form with `LINKEDIN_STOP_BEFORE_SUBMIT=true`; it can never submit and is intended for selector validation.

Semantic form memory:

- Uses local SQLite at `data/semantic-memory.sqlite` and Gemini `gemini-embedding-001` embeddings.
- Flow: security gate, deterministic answers, exact approved memory, vector similarity, then the bounded form-filling model.
- Model answers are stored as pending and become approved only after the form advances without validation errors.
- Prompt-injection patterns are blocked before any deterministic, semantic, or model filling. Sensitive answers are used only when explicitly present in the ignored trusted profile and exactly match a visible option; otherwise the automation opts out or stops.
- Automatic vector reuse requires similarity `>= 0.92` and a non-ambiguous score margin; lower trusted matches can be supplied as model hints.
- The embedding circuit breaker disables further embedding calls for the current run after provider failure.
- Node.js 22.5 or newer is required. Node 22 may print an `ExperimentalWarning` for its built-in SQLite module.
- On the first run, legacy `state.json` content is imported into the same SQLite database and the original file is preserved as a local, ignored backup.

Gmail OAuth:

1. Create a Google Cloud OAuth client for a Desktop app.
2. Save the downloaded JSON as `secrets/gmail-oauth-client.json`.
3. Run `npm run gmail:auth`.
4. Run `npm run gmail:test`.
5. Set `gmail.enabled` and `alerts.email_enabled` to `true` in `config.json`.

Private local data:

- `config.json`, `profile.json`, `state.json`, `data/`, `secrets/`, `.browser-profile/`, logs and machine-specific launchd files are ignored by Git.
- `state.json` is only a preserved migration backup after the operational state is imported into SQLite.
- Never place API keys, OAuth tokens, resumes or browser session files in source-controlled examples.
