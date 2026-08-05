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
- Kind: `interval`
- Interval: 27 minutes
- Jitter: 45 seconds

### Direct messages

- Mode: `auto`
- Kind: `interval`
- Interval: 27 minutes
- Jitter: 30 seconds
- Initial `next_run_at`: five minutes after the network pipeline's initial marker

Both interval schedules retain their relative five-minute offset after each execution. The CLI's own work-window checks remain a second safety boundary.

### Jobs

- Mode: `auto`
- Kind: `daily_times`
- Times: 09:00, 12:00, 16:00
- Jitter: 90 seconds

The cutover writes the schedules and future run markers directly. It does not enqueue a run.

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

1. Back up the three `pipeline_schedules` rows and key metadata without secret values.
2. Write the three approved schedules and future run markers in one SQLite transaction.
3. Copy supported API keys in the same local database without logging secrets.
4. Stop the temporary `npm run web` process.
5. Render and install the machine-specific web-console plist in `~/Library/LaunchAgents`.
6. Unload the two old pipeline LaunchAgents.
7. Load the web-console LaunchAgent.
8. Verify the new service, port, schedules, next-run offset, key counts, and file permissions.

The old agents are unloaded only after the database transaction succeeds. The new web service is loaded immediately afterward. If it fails to start, the old agents can be reloaded from their preserved plist files.

## Error handling and rollback

- Database failure: roll back the transaction; leave the old LaunchAgents loaded.
- Secret validation failure: skip only the invalid secret and report its provider/ordinal without its value.
- Port conflict: stop the temporary process and retry the persistent service once.
- New service failure: unload it and reload the preserved old agents.
- Verification failure after a successful start: keep all source secrets and plist files untouched and report the exact failed invariant.

## Verification

- `launchctl` no longer lists the inbox-cycle or jobs-scan agents as loaded.
- `launchctl` shows the web-console agent running with a successful state.
- `http://127.0.0.1:4321/api/status` reports an active scheduler and three automatic pipelines.
- The network and DM next-run markers differ by five minutes before jitter.
- Jobs list 09:00, 12:00, and 16:00 on Monday-Saturday.
- SQLite reports the expected Gemini/OpenRouter key counts without revealing secrets.
- Database, WAL, and SHM remain `0600`.
- No pipeline run is added to `pipeline_runs` during cutover.
