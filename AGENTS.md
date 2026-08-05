# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, and others) working in this repository.

## Commands

```bash
npm run setup            # deps + playwright chromium + web deps + web build
npm start                # builds the web bundle, then serves API + scheduler on :4321
npm run web              # server only (no rebuild), API on :4321
npm run web:dev          # Vite dev server on :4322, proxies /api to :4321
npm test                 # full Node test runner suite
npm --prefix web run build   # tsc --noEmit + vite build
```

Run a single test file or a single test:

```bash
node --test src/scheduler.test.js
node --test --test-name-pattern "profile gate" src/profile-gate.test.js
```

`npm test` lists its files explicitly in `package.json` — **a new `src/*.test.js` does not run
until it is added to that list.**

Pipelines are runnable standalone (useful for debugging; each prints a JSON result as its last
output block, which is what the scheduler parses):

```bash
npm run jobs:scan               # scan, evaluate, apply within limits
npm run jobs:apply-one -- <id>  # single record
npm run dm:check:headed         # visible browser — use this to log into LinkedIn
npm run network:accept
npm run validate                # configuration sanity check
npm run storage:status
```

`npm run jobs:form-smoke -- <url>` opens exactly one Easy Apply form with
`LINKEDIN_STOP_BEFORE_SUBMIT=true` and can never submit.

There is no linter. Verification is `node --check` on changed `src/*.js`, `npm test`, and
`npx tsc --noEmit` inside `web/`.

## Architecture

Node 22 ESM + Playwright + `node:sqlite`, with a React/Vite/Tailwind/shadcn console in `web/`.
No framework on the server: `src/web/server.js` is a hand-rolled `node:http` router bound to
loopback that also serves `web/dist`.

**Two processes, one SQLite file.** The web server (API + scheduler) and the CLI are separate
processes over one database. A pipeline can therefore be started from the interface, a
terminal, or an OS scheduler with no coordination beyond a run lock. Any invariant that must
hold has to be enforced in *both* the API/scheduler and the CLI — enforcing it only in the UI
is not enforcement.

The file is **`data/semantic-memory.sqlite`** — the name is historical, since it started as the
semantic-memory store and grew into the whole application store. Resolve it with
`bootstrapDatabasePath()` from `src/config.js`; typing a filename is how you end up reading a
database the app never opens.

**Config layering** (`src/config.js`): `DEFAULTS` ← database overrides ← environment, and
then `SAFETY` is force-applied last so nothing can
widen it. `src/config-defaults.js` holds `SAFETY`, `HARD_LIMITS` and the `EDITABLE` whitelist
that the settings screen is generated from. **Guard rails live in code, not in the database**,
deliberately: a bug or prompt injection reaching a write path must not be able to widen what
the agent discloses. Adding a user-editable setting means adding it to `EDITABLE` with a
coercion type. User configuration and secrets are stored in SQLite, never project files.

**The profile is the agents' only trusted source of facts** about the user (`profile-schema.js`
defines one contract shared by the UI form, the extraction prompt and the agents). A résumé
cannot be trusted to say whether the user is PCD, a veteran, etc., so `job-eligibility.js`
deterministically refuses vacancies exclusive to a group the profile does not explicitly
declare — silence is never a yes — and the same guard runs on manual sends.

**The profile gate** (`profile-gate.js`) disarms every pipeline while required profile fields
are missing. It is checked in four places because each can be reached independently: the
scheduler (`tick`, `enqueue`, `enqueueCommand`, and a final check in `#drain` before spawn),
the HTTP API (arming a schedule, "run now", manual send), the CLI entry points, and the UI.
Readiness is decided by the profile data itself, **not** by the `onboarding_complete` flag.

**Standardized records** (`agent-record.js`): jobs, DMs and invites normalize into one shape
in one table so the interface can show them together. `send_state` (`SEND_STATES` /
`SENDABLE_STATES`) is what enables or disables the send button and what prevents a record
already sent from being sent twice after a rescan.

**Model routing** (`resolveModelRoute` in `cli.js`): providers carry a role — `primary`,
`fallback`, `none` — stored in the database (`providers.js` owns the catalog and the rule that
the second configured provider automatically becomes the fallback). All three providers
(Gemini, OpenAI, OpenRouter) accept multiple keys and rotate them round-robin via a per-provider
cursor in `local_metadata`. All three use provider-native structured output (Gemini
`responseSchema`, OpenAI `text.format.json_schema`, OpenRouter `response_format.json_schema`);
`model-json.js` additionally salvages complete fields from truncated responses.

**Résumé matching** is intentionally cheap: each résumé is indexed by the model **once** on
upload (`resume:index`), per-job matching is keyword affinity against that index (zero model
calls), and the job evaluator — which already runs per job — may return a `resume_id` that wins
when valid. Do not replace this with sending résumé bodies per job.

**Scheduling** (`cron.js` + `scheduler.js`): 5-field cron with POSIX day-of-month/day-of-week
union, plus interval and daily-times modes, an allowed weekday/hour window, jitter, and a
global pause (`pause.js`). The scheduler runs **one pipeline at a time** because they share a
single Chromium profile (`.browser-profile`). `network` and `dm` are paired five minutes apart
when both are on the same `daily_times` cycle; pairing is an optimization, and any other valid
combination must fall back to independent scheduling rather than reporting an error.

**Onboarding** is two steps (`OnboardingPage`): the profile form, then pipelines. The
completion flag is no longer flipped by saving the profile — `POST /api/profile/complete-onboarding`
does it, so the first run always passes through scheduling. On step 1 the résumé is given
*either* as text or as a file, never both (`ResumeSourcePicker`), and one fill button reads
from whichever is active. `extraction-source.js` hashes what the extraction last read and the
server stores it in `app_settings`; the button re-arms only when that changes, since a repeat
run costs a model call and returns identical fields. `web/src/lib/hash.ts` mirrors the same
normalization client-side so both sides compare the same value.

**LinkedIn session.** `linkedin-session.js` decides what counts as signed in, and requires two
independent signals — the URL did not bounce to the login pattern **and** the `li_at` cookie is
present — because either one alone lies. A `checkpoint` URL is two-step verification in
progress, so the login loop waits instead of failing. The session is never copied out of the
Chromium profile; `app_settings.linkedin_session` holds state only. `linkedin-gate.js` blocks
runs but deliberately does **not** park schedules the way the profile gate does: expiry is
transient and frequent, and clearing `next_run_at` each time would turn it into a mess.
`linkedin:login` runs as a queued CLI command so the login window takes the same turn a pipeline
would — the browser profile is exclusive and two processes cannot open it.

**Résumés.** `resume-gate.js` blocks Easy Apply and the digest email when no document is
stored; scanning stays allowed because it sends nothing. `resume-selection.js` holds the
résumé step of the form and is separate from `cli.js` precisely so the decision flow — expand,
look, select or upload, verify — can be tested against a fake page. Selection is verified after
the click: an unverified selection is the one failure that silently submits the wrong document.
The matching rules in `resume-upload.js` accept LinkedIn's truncation but refuse a short prefix
standing in for a longer name; loosening that is how the wrong résumé gets attached.

**Alerts and auto-fix.** `alert-dedupe.js` fingerprints a failure by command, status and a
normalized message (ids, paths, timestamps and numbers stripped) so repeats collapse into one
group; `AppStore.recordAlert` counts the occurrence and decides delivery inside a
`BEGIN IMMEDIATE` transaction, because two processes failing at once must not both conclude
they are the first. Every alert goes through one `dispatchAlert` in `cli.js` — the log always
records, the mailbox does not.

`auto-fix.js` optionally hands the failure to a coding-agent CLI (`cli-agents.js`, same role
model as the model providers). The containment in `auto-fix-sandbox.js` is layered, and the
order matters: a generated bin directory that becomes the agent's entire `PATH` is the only
layer that holds when the instruction is ignored — the CLI's own flags and the prompt text are
second opinions. Widening `ALLOWED_BINARIES` is a security decision, not a convenience one.
Untrusted failure text is sanitized and fenced in markers it cannot close before entering the
prompt. The agent restarts only via `npm run service:restart`, which refuses when no supervisor
is detected (`service-restart.js`), since exiting unsupervised stops the service.

## Conventions

- **Secrets never reach the client.** API keys, OAuth client secrets and tokens stay in the
  `chmod 600` SQLite file; client-facing payloads carry masked hints and presence flags only,
  and provider errors pass through `redactSecrets`. There is a regression test that scans every
  client-facing payload — keep new endpoints covered by it.
- **Email sending stays off** until an account is connected, a recipient is saved, and the user
  explicitly enables it; `sendGmail` returns `{status:'disabled'}` rather than throwing.
- **Partial saves.** A field that fails validation must not discard its valid siblings —
  persist what coerces and withhold only the completion flag.
- **UI text is bilingual.** `web/src/lib/i18n.tsx` holds a `pt-BR` map and an `en` map with the
  same keys; add to both. Portuguese labels and messages are written **with accents** (there is
  a test asserting no unaccented placeholders in labels).
- Comments explain *why* a constraint exists, not what the line does; several of them encode
  reasoning that is expensive to re-derive.
- Application stores (`data/`, `.browser-profile/`, `logs/`, machine-specific launchd plists)
  are gitignored and must stay out of commits.
