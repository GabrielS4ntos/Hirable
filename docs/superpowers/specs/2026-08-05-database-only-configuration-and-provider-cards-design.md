# Database-only configuration and provider cards

## Objective

Make SQLite the sole persisted source for user profile, operational state, provider keys, OAuth credentials, and UI-managed settings. Remove the legacy local JSON and dotenv compatibility layer. At the same time, make model-provider cards consistent and update the OpenAI catalog to the current GPT-5.6 family.

## Scope

This change removes `config.json`, `config.example.json`, `profile.example.json`, `state.json`, `secrets.env.example`, and `secrets/.env`. The already-removed `profile.json` and Google OAuth JSON files remain unsupported. It also removes runtime reads, imports, status fields, documentation, and tests whose purpose is to preserve those file fallbacks.

Technical defaults remain in `src/config-defaults.js`. Deployment environment variables may continue to override bootstrap/runtime values, but the application must not require or create any of the legacy, manually edited configuration and state files named above. SQLite remains under `data/` and browser session data remains in `.browser-profile/`; those are application-managed stores and are intentionally local.

Concurrent LinkedIn-session work in `src/cli.js`, `src/config-defaults.js`, `src/linkedin-gate.js`, and `src/linkedin-session.js` is outside this change and must be preserved.

## Configuration boundary

`resolveConfig` starts from code defaults, merges database overrides, then applies deployment environment overrides and immutable safety policy. It no longer reads or accepts a legacy config object. Database bootstrap uses the default database path or `AGENT_DATABASE_PATH`; it does not inspect `config.json`.

The global editable `timezone` setting is the only user timezone. Calendar event creation uses `config.timezone`; there is no separate `calendar.timezone`. Before deleting `config.json`, migration compares the database override with the effective legacy calendar timezone. An existing non-empty database `timezone` is authoritative and is never overwritten. If the database override is absent, the migration writes the legacy `calendar.timezone`, falling back to the current effective global timezone only when the legacy field is absent. It then reads the value back and verifies that config resolution and calendar creation use it.

The one-time `config.json` importer and its marker are removed from startup. Existing database overrides are not rewritten or reset.

## Profile and operational state

Profile reads use `AppStore.getUserProfile()` exclusively. The profile gate evaluates only the stored profile. Error messages direct the user to onboarding instead of suggesting `profile.json`.

Operational state uses the SQLite runtime-state store exclusively. The cleanup first inspects the existing runtime-state row. A populated SQLite row is authoritative and `state.json` is ignored. If no row exists and `state.json` contains a valid non-empty state, that state is imported once, read back, and compared before deletion. If neither source contains state, the canonical empty state is persisted to SQLite. After this cleanup, runtime code never imports `state.json`, records a legacy path/hash, or reports that a legacy backup was preserved.

Before deletion, the implementation uses this matrix for every state-bearing legacy file:

- Authoritative database data exists: preserve it and do not import the file.
- Database data is absent and the legacy file contains valid state: migrate it, read it back, and verify equivalence.
- Both sources are absent or empty: initialize the documented database default where required.

The profile, timezone, and operational state must all pass their read-back checks before their files and compatibility code are removed. A populated database row is never overwritten with file data.

## Secrets and integrations

Model API keys come only from the `api_keys` table. The CLI no longer loads `secrets/.env`, and provider routing does not read `GEMINI_API_KEY(S)`, `OPENROUTER_API_KEY(S)`, or `OPENAI_API_KEY(S)` from the process environment. OAuth credentials come only from `oauth_credentials`; errors direct the user to the integrations UI.

Non-secret deployment configuration variables such as `AGENT_DATABASE_PATH`, `AGENT_PROFILE_PATH`, `AGENT_BROWSER_PROFILE_DIR`, `LINKEDIN_HEADLESS`, and `GOOGLE_REDIRECT_PORT` remain allowed where still applicable; obsolete variables such as `AGENT_PROFILE_PATH` are removed together with the corresponding file feature. Process-level credentials needed by external coding-agent CLIs are outside the application's provider-key store and may still be inherited by those external commands from the launching environment. Removing `secrets/.env` must not introduce a new mechanism for persisting those credentials or make them available to application model routing.

## Provider catalog and cards

The OpenAI provider offers `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`, with `gpt-5.6-terra` as the default. Existing saved model selections remain unchanged; only providers without a saved model receive the new default.

Every provider card displays `provider.model || provider.default_model` as its subtitle, including providers with no key. Key-format hints remain available only where a key is entered and are never used as card subtitles.

`ProviderCards` renders actions in this stable vertical order:

1. Primary-role slot.
2. Optional `Usar como fallback` action for an eligible configured provider with role `none`.
3. `Adicionar chave` / `Configurar`, always last.

The primary-role slot is exact for every state:

- Unconfigured: disabled `Tornar principal`.
- Configured primary: disabled `Principal atual`.
- Configured fallback or role `none`: enabled `Tornar principal`.

Existing role rules remain enforced by the provider API; disabled controls are presentation, not authorization. The card subtitle uses the existing `model` and `default_model` fields returned by the providers endpoint, and no API shape change is required.

## Deletion and documentation

Delete the five root legacy/example files and `secrets/.env`. Remove instructions that tell users to copy, edit, retain, or recover from these files. `.gitignore` may retain defensive patterns for secret/data filenames so accidental re-creation is not committed, but no shipped example or runtime path may advertise them as supported configuration.

The temporary `.superpowers/` visual-companion output is not part of the product and must not be committed.

## Error handling

- Missing profile data fails closed with the existing `profile_incomplete` gate and points to onboarding.
- Missing model keys leaves the provider unconfigured and model-backed actions gated through the existing provider roles.
- Missing OAuth data disables integration delivery and points to the integrations UI.
- Missing runtime state initializes the canonical empty state in SQLite.
- A database open or write failure remains fatal for the affected operation; there is no file fallback.

## Verification

- Unit tests prove config resolution does not read `config.json` and calendar events use the global database-backed timezone.
- Profile-gate tests prove no filesystem profile is consulted.
- Runtime-state tests prove missing state initializes SQLite and `state.json` is never read or created.
- Provider tests cover the GPT-5.6 catalog and Terra default while preserving saved model values.
- Component tests, or focused render assertions where the project supports them, cover default-model subtitles and action order/disabled state.
- Repository search confirms no active runtime or user documentation references the removed fallbacks.
- Full Node test suite and production web build pass.
