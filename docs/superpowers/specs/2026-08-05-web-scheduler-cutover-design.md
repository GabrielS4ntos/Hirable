# Web scheduler cutover design

## Objective

Replace the two pipeline-specific user LaunchAgents with one persistent web-console LaunchAgent. Store the active schedules in the existing SQLite database and preserve the established cadence without immediately executing any LinkedIn pipeline.

Copy only secrets already supported by the database into its existing `api_keys` table. Keep every source secret file intact for rollback.

## Current state

- `com.gabriel.linkedin-inbox-cycle` coordinates network invitations and DMs through `launchd`.
- `com.gabriel.linkedin-jobs-scan` runs the jobs pipeline through `launchd`.
- The web console is temporarily running from the current terminal session.
- Its SQLite scheduler is active, but all three schedules are in `manual` mode.
- The `api_keys` table accepts only `gemini` and `openrouter` providers.
- OpenAI keys and Google OAuth tokens have no supported database representation.

## Selected architecture

One user LaunchAgent named `com.gabriel.linkedin-web-console` will run `npm run web` with `RunAtLoad` and `KeepAlive`. The web server's scheduler becomes the only pipeline coordinator.

The old LaunchAgents will be unloaded but their plist files will remain on disk for rollback. The temporary terminal-hosted web process will be stopped before loading the persistent service so only one process can bind to `127.0.0.1:4321`.

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

Explicit daily times preserve the five-minute phase after first boot, restart, downtime, and macOS suspension. They avoid the current scheduler behavior that recomputes interval markers from `last_run_at` during boot. Each list has 31 entries; no invitation run is scheduled without a corresponding DM run. The CLI's own work-window checks remain a second safety boundary.

### Jobs

- Mode: `auto`
- Kind: `daily_times`
- Times: 09:00, 12:00, 16:00
- Jitter: 90 seconds

The 09:00/12:00/16:00 normalization is intentional and was explicitly selected by the user instead of preserving the old 09:07/12:11/16:13 markers. The cutover writes the schedules and lets the new scheduler calculate future run markers. It does not enqueue a run.

## Secret migration

The existing `api_keys` table stores only Gemini and OpenRouter secrets. The migration will:

1. Read `GEMINI_API_KEYS` and `OPENROUTER_API_KEY` from the ignored `secrets/.env` without printing their values.
2. Compare secrets by an in-process cryptographic digest to avoid duplicate inserts.
3. Insert missing Gemini keys with stable migration labels and priorities suitable for round-robin use.
4. Insert the missing OpenRouter fallback key.
5. Leave `secrets/.env` unchanged.

No OpenAI key will be copied because the schema rejects the `openai` provider. No Google OAuth client or token will be copied because the database has no OAuth token table. This follows the explicit rule to do nothing for unsupported secret types.

The database, WAL, and shared-memory files are already mode `0600`; permissions will be rechecked after migration. API responses expose masked keys only.

## Cutover sequence

1. Back up the complete three `pipeline_schedules` rows, the pre-cutover `pipeline_runs` count, and API-key metadata without secret values. Record the IDs of any keys inserted during migration.
2. Verify that the Mac timezone is `America/Sao_Paulo` and that the cutover is not within five minutes of 09:00, 12:00, or 16:00. Abort before mutation if either precondition fails.
3. Resolve the process bound to port 4321 and verify its command and working directory belong to this project. Stop only that temporary `npm run web` process. Abort if another process owns the port.
4. Unload the two old pipeline LaunchAgents. Require successful unload and verify that their labels, child Node/Playwright processes, and run lock are absent before continuing.
5. In one SQLite transaction, copy supported API keys and replace all three schedules, including `mode=auto`, schedule kind, explicit times, weekdays, timezone, window, jitter, runtime markers, and status. Roll back the whole transaction on any error.
6. Render and install the machine-specific web-console plist in `~/Library/LaunchAgents`.
7. Load the web-console LaunchAgent.
8. Verify the new service, port, schedules, next-run offset, key counts, file permissions, and unchanged `pipeline_runs` count after the first scheduler tick.

The database remains in manual mode while the temporary web process is alive, so no scheduler can observe partially migrated automatic schedules. The old agents are unloaded and verified before the short activation transaction. If the new service fails any critical verification, it is unloaded, the complete schedule snapshot is restored, inserted key IDs are removed, and the old agents are reloaded and revalidated from their preserved plist files.

## Error handling and rollback

- Database failure: roll back the transaction and reload the old LaunchAgents because they have already been unloaded at the activation stage.
- Secret validation failure: skip only the invalid secret and report its provider/ordinal without its value.
- Port conflict: stop a process only after proving it belongs to this project; otherwise abort without mutation.
- Old-agent unload failure or surviving child/lock: abort and restore the previously loaded agents before any automatic database schedule is committed.
- New service failure: unload it, restore the database snapshot, remove only keys inserted by this cutover, and reload the preserved old agents.
- Verification failure after a successful start: perform the same complete rollback, then report the exact failed invariant.
- Timezone mismatch: abort. The scheduler uses the Mac's local timezone even though the row stores a timezone label.

## Verification

- `launchctl` no longer lists the inbox-cycle or jobs-scan agents as loaded.
- `launchctl` shows the web-console agent running with a successful state.
- `http://127.0.0.1:4321/api/status` reports an active scheduler and three automatic pipelines.
- Network and DM store explicit 27-minute daily sequences with a five-minute phase; their next-run markers match the next members of those sequences.
- Jobs list 09:00, 12:00, and 16:00 on Monday-Saturday.
- SQLite reports the expected Gemini/OpenRouter key counts without revealing secrets.
- Database, WAL, and SHM remain `0600`.
- No pipeline run is added to `pipeline_runs` during cutover.
- On rollback, the old LaunchAgents are loaded again and their previous operational state is verified.
