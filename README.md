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
npm run jobs:form-smoke -- 'https://www.linkedin.com/jobs/view/<id>/apply/?openSDUIApplyFlow=true'
npm run semantic:mock
npm run semantic:smoke
npm run gmail:auth
npm run gmail:test
npm run validate
npm run storage:status
```

First run:

1. Copy `config.example.json` to the ignored local file `config.json`.
2. Copy `profile.example.json` to the ignored local file `profile.json` and fill it with trusted facts only.
3. Copy `secrets.env.example` to `secrets/.env` and provide model keys.
4. Run `npm install` and `npx playwright install chromium`.
5. Run `npm run dm:check:headed` and log in to LinkedIn if needed.
6. Run `npm run dm:check:headless` after the messaging page loads.

The browser profile is stored in `.browser-profile` under this folder.

Local scheduling:

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
