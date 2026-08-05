# Web scheduler cutover design

## Objective

Replace the two pipeline-specific user LaunchAgents with one persistent web-console LaunchAgent. Store the active schedules in the existing SQLite database and preserve the established cadence without immediately executing any LinkedIn pipeline.

Copy only supported model-provider secrets into the existing `api_keys` table and migrate the existing Google OAuth client/token into `oauth_credentials`. Keep every source secret file intact for rollback. The unused OpenAI key is ignored.

## Current state

- `com.gabriel.linkedin-inbox-cycle` coordinates network invitations and DMs through `launchd`.
- `com.gabriel.linkedin-jobs-scan` runs the jobs pipeline through `launchd`.
- The web console is temporarily running from the current terminal session.
- Its SQLite scheduler is active, but all three schedules are in `manual` mode.
- The `api_keys` table accepts only `gemini` and `openrouter` providers.
- The `oauth_credentials` table supports a Google OAuth client, token, scopes, account email, and connection metadata.
- The current database has a client placeholder but no connected Google token; the ignored local files contain the active client and token to migrate.
- OpenAI is not used by the configured model routing.

## Selected architecture

One user LaunchAgent named `com.gabriel.linkedin-web-console` will run `npm run web` with `RunAtLoad` and `KeepAlive`. The web server's scheduler becomes the only pipeline coordinator.

The old LaunchAgents will be unloaded, persistently disabled, and moved out of `~/Library/LaunchAgents` into a private rollback directory. This prevents macOS from loading them again after login or restart. Their plist files remain available for rollback. The temporary terminal-hosted web process will be stopped before loading the persistent service so only one process can bind to `127.0.0.1:4321`.

## Schedule configuration

All schedules use timezone `America/Sao_Paulo`, weekdays Monday through Saturday (`[1,2,3,4,5,6]`), and the 08:00-22:00 window.

### Network invitations

- Mode: `auto`
- Kind: `daily_times`
- Times: an explicit 27-minute sequence anchored at 08:00, ending at 21:30
- Jitter: 45 seconds

### Direct messages

- Mode: `auto`
- Kind: `daily_times`
- Times: the same explicit sequence shifted five minutes, from 08:05 through 21:35
- Jitter: 30 seconds

Explicit daily times define the five-minute phase. A small pair-aware scheduler rule preserves it after first boot, restart, downtime, and macOS suspension: network and DM are refreshed as one pair, never independently. The refresh selects the next future network slot and sets DM to that slot plus five minutes. If startup happens between a network slot and its DM slot, that orphan DM is skipped and the next complete pair is selected. Each list has 31 entries; no invitation run is scheduled without a corresponding DM run. The CLI's own work-window checks remain a second safety boundary.

`Scheduler.refreshAllNextRuns()` will call a dedicated inbox-pair refresh and skip individual refresh for `network` and `dm`. The same pair-aware rule applies when either schedule is edited and when the service resumes after downtime. Tests cover initial boot, restart before a pair, restart between the two members, and resumption after suspension.

### Jobs

- Mode: `auto`
- Kind: `daily_times`
- Times: 09:00, 12:00, 16:00
- Jitter: 90 seconds

The 09:00/12:00/16:00 normalization is intentional and was explicitly selected by the user instead of preserving the old 09:07/12:11/16:13 markers. The cutover writes the schedules and lets the new scheduler calculate future run markers. It does not enqueue a run.

## Secret and OAuth migration

The existing `api_keys` table stores only Gemini and OpenRouter secrets. The migration will:

1. Read `GEMINI_API_KEYS` and `OPENROUTER_API_KEY` from the ignored `secrets/.env` without printing their values.
2. Compare secrets by an in-process cryptographic digest to avoid duplicate inserts.
3. Insert missing Gemini keys with stable migration labels and priorities suitable for round-robin use.
4. Insert the missing OpenRouter fallback key.
5. Leave `secrets/.env` unchanged.

The OpenAI key is ignored completely because OpenAI is not used and the schema rejects that provider.

For Google OAuth, the migration will:

1. Read the ignored `secrets/gmail-oauth-client.json` and `secrets/gmail-token.json` without printing their contents.
2. Validate the client through `saveOAuthClient("google", ...)`.
3. Derive granted scopes from the token's `scope` field, falling back to `config.gmail.scopes`, and use the configured Gmail account as account metadata.
4. Store the token through `saveOAuthToken("google", ...)`, preserving its refresh token.
5. Verify only the safe projection: client configured, connected, refresh token present, scope set, and account email. No token or client secret is returned to logs or the UI.
6. Leave both source JSON files unchanged.

The database, WAL, and shared-memory files are already mode `0600`; permissions will be rechecked after migration. API responses expose masked keys only.

## Cutover sequence

1. Write a durable cutover recovery file under ignored local `data/` with mode `0600`. It contains the complete three `pipeline_schedules` rows, pre-cutover `pipeline_runs` count, old plist locations and labels, API-key metadata without secrets, inserted key IDs, the complete pre-cutover Google OAuth row needed for rollback, and a phase marker updated after every step.
2. Verify that the Mac timezone is `America/Sao_Paulo`. Abort before mutation if it differs.
3. Resolve the process bound to port 4321 and verify its command and working directory belong to this project. Stop only that temporary `npm run web` process. Abort if another process owns the port.
4. Unload and persistently disable the two old pipeline LaunchAgents. Move their installed plists into a private rollback directory outside `~/Library/LaunchAgents`. Require successful unload and verify that their labels, child Node/Playwright processes, and run lock are absent before continuing.
5. In one SQLite transaction, copy supported API keys, migrate the Google OAuth client/token, and replace all three schedule definitions, but keep every schedule in `manual` mode with null runtime markers. Roll back the whole transaction on any error.
6. Render and install the machine-specific web-console plist in `~/Library/LaunchAgents`, then load it.
7. Verify the new service, port, scheduler health, desired schedule definitions, key counts, file permissions, and unchanged `pipeline_runs` count while every pipeline remains manual.
8. In a final short transaction, change the three modes to `auto`. Compute and persist the next complete inbox pair explicitly: the next future network slot and its DM slot five minutes later. Set the jobs marker to its next strictly future daily time.
9. Wait through the first scheduler tick and verify the persisted complete pair, five-minute phase, future jobs marker, and unchanged `pipeline_runs` count. Mark the recovery file complete but preserve it for rollback audit.

The database remains in manual mode until the persistent web service is healthy, so no scheduler can observe partially migrated automatic schedules. The old agents are unloaded, disabled, and moved before the final short activation transaction. If the new service fails any critical verification, it is unloaded, its installed plist is moved out of `~/Library/LaunchAgents`, the complete schedule snapshot is restored, inserted key IDs are removed, and the old plists are restored, re-enabled, reloaded, and revalidated. The durable phase file makes each recovery step idempotent after interruption or process death.

## Error handling and rollback

- Database failure: roll back the transaction and reload the old LaunchAgents because they have already been unloaded at the activation stage.
- Secret validation failure: skip only the invalid secret and report its provider/ordinal without its value.
- Port conflict: stop a process only after proving it belongs to this project; otherwise abort without mutation.
- Old-agent unload failure or surviving child/lock: abort and restore/re-enable the previously loaded agents before any automatic database schedule is committed.
- New service failure: unload it, remove its installed plist from `~/Library/LaunchAgents`, restore the schedule and OAuth database snapshots, remove only keys inserted by this cutover, and restore/re-enable/reload the preserved old agents.
- Verification failure after a successful start: perform the same complete rollback, then report the exact failed invariant.
- Timezone mismatch: abort. The scheduler uses the Mac's local timezone even though the row stores a timezone label.

## Verification

- `launchctl` no longer lists the inbox-cycle or jobs-scan agents as loaded.
- `launchctl` shows the web-console agent running with a successful state.
- `http://127.0.0.1:4321/api/status` reports an active scheduler and three automatic pipelines.
- Network and DM store explicit 27-minute daily sequences with a five-minute phase; their next-run markers match the next members of those sequences.
- Jobs list 09:00, 12:00, and 16:00 on Monday-Saturday.
- SQLite reports the expected Gemini/OpenRouter key counts without revealing secrets.
- The safe Google integration status reports client configured, connected, refresh token present, expected scopes, and account email without revealing secrets.
- Database, WAL, and SHM remain `0600`.
- No pipeline run is added to `pipeline_runs` during cutover.
- On rollback, the old LaunchAgents are loaded again and their previous operational state is verified.
- The old installed plists are absent from `~/Library/LaunchAgents` during normal web-scheduler operation, and the new installed plist is absent after rollback.
- A mode-`manual` health check occurs before activation, and activation persists one strictly future complete network/DM pair plus a strictly future jobs marker.
- Pair-aware scheduler tests prove that boot/restart/suspension never produce an orphan DM marker or erase the five-minute phase.
- The durable `0600` recovery file records a completed phase and is sufficient for idempotent rollback after interruption.
