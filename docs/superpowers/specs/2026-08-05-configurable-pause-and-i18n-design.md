# Configurable pause and frontend internationalization design

## Objective

Remove the CLI's fixed Monday-Saturday 08:00-22:00 execution lock. Replace it with one global daily pause configured exclusively through the web console and stored in SQLite. Automatic and manual behavior must be explicit, visible, and editable in the interface.

Add complete Portuguese and English localization to the React frontend. The selected language must affect every application-owned label, page, status, validation message, toast, date, accessibility label, and piece of metadata rendered by the UI. LinkedIn content and user-entered data remain unchanged.

## Scope and invariants

All user-facing operational timing is configured through the interface. Immutable security rules, prompt-injection defenses, filesystem paths required to bootstrap the database, and hard safety ceilings remain code-owned guardrails; they are not user preferences.

The implementation preserves these invariants:

- one browser profile and at most one pipeline process at a time;
- paired network/DM scheduling, with DM five minutes after network;
- no automatic run begins during the configured pause;
- the pause may cross midnight;
- pause evaluation uses the configured application timezone for every backend decision and preview;
- a manual run follows the interface's `allow_manual_runs` preference;
- changing language never changes stored profile values, LinkedIn text, model prompts, or pipeline decisions;
- backend logs remain operational and need not be localized;
- Portuguese remains the default for existing installations.

## Global pause model

The effective configuration gains a `pause` object:

```json
{
  "pause": {
    "enabled": true,
    "start": "22:00",
    "end": "08:00",
    "allow_manual_runs": true
  }
}
```

All four values are part of the server's editable allowlist, persisted in the existing SQLite configuration overrides, and rendered in General Settings. `start` and `end` use strict `HH:MM` validation. When pause is enabled they cannot be equal; an equal pair is rejected rather than ambiguously meaning either zero or twenty-four hours. A disabled pause places no global time restriction.

The UI presents an enabled switch, two time inputs, and a switch labeled "Allow Run now during pause". It also presents a live sentence describing the effective interval and whether manual runs are allowed.

The pause uses the existing editable `timezone` setting as its sole timezone. Backend evaluation, next-pause-boundary calculation, schedule previews, status payloads, and frontend date/time formatting all use that same IANA timezone. Changing the timezone immediately refreshes future markers. DST gaps and repeated hours follow the platform's `Intl` timezone rules and are covered by tests.

### Runtime semantics

A shared pure helper evaluates whether a date is paused:

- if pause is disabled, it returns false;
- for `start < end`, times in `[start, end)` are paused;
- for a cross-midnight interval such as 22:00-08:00, times at or after 22:00 or before 08:00 are paused;
- the end boundary is runnable, while the start boundary is paused.

The scheduler consults the pause before calculating and persisting `next_run_at`, before enqueueing an automatic pipeline, and when producing previews. Candidates that fall inside the pause are advanced to the first valid future schedule slot. Network and DM continue to be calculated as a complete pair; a pair is accepted only when both members are outside the pause.

The scheduler checks the pause again when draining the queue, immediately before spawning a child process. This closes the race where a job was queued before the pause began or while the configuration changed:

- an automatic queued run is cancelled, recorded as `skipped` with code `pause_active_before_start`, and its next marker is recomputed after the pause;
- a manual queued run is allowed only if the current `allow_manual_runs` value is true; otherwise it is cancelled and recorded as `skipped` with the same stable code;
- a process that has already started is allowed to finish.

Manual runs initiated by the web API are accepted during the pause only when `allow_manual_runs` is true. Otherwise the API returns a structured `pause_active` conflict without adding a run. Manual single-record Easy Apply follows the same rule.

The CLI removes `shouldRunInWorkWindow`, `skipIfOutsideWorkWindow`, and `LINKEDIN_IGNORE_WORK_WINDOW`. Scheduled child processes receive trigger context from the scheduler, and the CLI uses the same resolved pause configuration as a defensive second check. There is no hidden hour, weekday, or environment-variable bypass. Direct CLI invocations are treated as manual runs.

### Existing schedule migration

The database currently has 08:00-22:00 per-pipeline windows created by the old fixed rule. A versioned, idempotent migration clears exactly that legacy window on the three known pipelines when migration marker `pause_config_v1_migrated_at` is absent. Initialization of the default pause values, matching-window updates, and marker write happen in one `BEGIN IMMEDIATE` transaction. A crash therefore leaves either the entire old state or the entire new state. Other user-customized pipeline windows are preserved. Per-pipeline windows remain an optional, visible additional restriction in the scheduling cards.

Existing installations receive the default 22:00-08:00 pause, preserving their prior automatic behavior while moving ownership to the interface. The default applies every day; weekday selection remains a property of each pipeline schedule.

## Internationalization architecture

The frontend uses an internal, typed localization layer rather than adding a runtime dependency. It consists of:

- `LanguageProvider`, mounted above the rest of the application;
- a `useI18n()` hook exposing `locale`, `setLocale`, `t`, and locale-aware formatters;
- complete `pt-BR` and `en` dictionaries with identical typed keys;
- a language control in the application shell and onboarding screen;
- localStorage persistence under a versioned key;
- initial locale resolution from the saved choice, then `pt-BR`;
- synchronization of `<html lang>` whenever locale changes.

The language switch is available before onboarding is complete and after login. It is a two-option control labelled `Português` and `English`; changing it applies immediately without reload.

Existing and fresh installations both start in Portuguese when no saved choice exists. Browser language is deliberately not used, so an existing Portuguese console cannot unexpectedly switch after deployment. Once selected, English remains selected across reloads through the versioned localStorage preference.

### Translation coverage

All application-owned frontend text moves behind translation keys:

- navigation, headers, scheduler summaries, badges, empty/loading/error states;
- dashboard, jobs, profile, onboarding, API keys, settings, and integrations;
- dialogs, table columns, filters, buttons, tooltips, accessibility labels, and toasts;
- general-setting groups and field labels;
- pipeline names/descriptions and schedule modes/kinds;
- profile section/field labels, hints, enum display values, and demographic explanations;
- send states, decisions, disabled reasons, and run statuses;
- date, time, number, plural, and duration formatting.

Dynamic metadata is translated by stable identifiers instead of translated server prose:

- pipeline ID for pipeline labels and descriptions;
- configuration path for configuration fields;
- profile section/field keys for schema-driven forms;
- canonical enum value for option labels;
- status/error code for status and validation messages.

The API may continue returning Portuguese fallback prose for backward compatibility, but every backend-owned value rendered by the frontend also has a stable code and structured interpolation parameters. This includes interactive errors, schedule errors, `last_status`, run status/errors, record send states and blocked reasons, integration errors, and migrated historical status prose. API serializers normalize legacy rows into codes at read time without rewriting audit history. The new frontend translates every known code and shows a localized generic message plus the code for unknown failures; raw backend prose is available only in a diagnostic detail in Portuguese mode and is never used as English UI copy. External job titles, recruiter messages, company names, URLs, resume text, user-entered free text, and model-authored analysis are data and are never translated.

## API and data flow

`GET /api/config` continues to return editable field descriptors but adds stable metadata and pause fields. The React client uses `path` to localize labels rather than rendering `label` directly.

`PUT /api/config` validates the pause patch atomically as one group. If any pause value is invalid, none of the pause values are changed; unrelated valid fields in the same request may still be applied under the existing per-field behavior. The response contains stable rejection codes and refreshed descriptors.

`GET /api/status` includes the effective pause state:

- configured values;
- whether the application is currently paused;
- the next pause boundary;
- whether a manual run is allowed now.

All status-like API projections use `{ code, params, raw? }`. `params` contains only non-secret interpolation data. New writes persist stable codes where the schema already has a status/reason column; read serializers map known legacy prose to the corresponding code and otherwise return `unknown_legacy_status` without presenting the prose as localized UI.

Pipeline update and cron-preview routes calculate future runs using the effective global pause. Run routes return HTTP 409 with `code: "pause_active"` when a manual action is blocked.

The language is a browser preference, not an automation preference, so it remains in localStorage rather than SQLite. API payloads remain language-neutral wherever possible.

## Error handling

- Invalid time syntax: reject with `pause_time_invalid`.
- Equal start/end while enabled: reject with `pause_interval_empty`.
- Automatic run becomes due during pause after a configuration change: do not enqueue it; recompute its marker.
- Pause configuration changes while a pipeline is already running: allow that run to finish; the pause controls starting work, not terminating it.
- Pause starts or is changed after enqueue but before spawn: cancel the queued item using `pause_active_before_start`; never leave a queued row stuck.
- Manual run blocked during pause: return 409 before creating a `pipeline_runs` row.
- Missing translation key in development/test: fail loudly; production falls back to Portuguese key content and records the missing key in the console.
- Corrupt saved locale: ignore it and resolve directly to `pt-BR`.
- Unknown backend error in English: show a localized generic message and stable code, never untranslated backend prose.

## Testing and verification

Backend unit tests cover:

- disabled, same-day, cross-midnight, and boundary pause evaluation;
- invalid/equal time validation and atomic persistence;
- automatic scheduling skipping paused candidates;
- paired network/DM calculation across a pause boundary;
- manual-run allow/block behavior without creating a run when blocked;
- direct CLI behavior with no environment bypass;
- idempotent clearing of only the legacy 08:00-22:00 pipeline windows.
- application-timezone evaluation across a DST gap and repeated hour;
- queue-drain revalidation for both automatic and manual jobs;
- transactional rollback of pause initialization, legacy-window clearing, and migration marker.

Frontend verification covers:

- dictionary key parity and no missing translation keys;
- locale resolution and persistence;
- locale-aware dates, numbers, plurals, and durations;
- stable-key translation for pipelines, configuration fields, profile fields, options, and errors;
- stable code/parameter rendering for current and historical schedule, run, record, and integration states;
- a production TypeScript/Vite build;
- browser walkthrough of every route in Portuguese and English, including pre-onboarding and normal application shells;
- saving a pause through the UI and verifying the effective state through `/api/status`;
- a blocked manual-run test and an allowed manual-run test using a harmless mock pipeline path, never LinkedIn side effects.

Completion requires searching the frontend for remaining user-facing hardcoded Portuguese or English strings and manually classifying every match. Source identifiers, CSS classes, test fixtures, external content, and developer comments are excluded; visible application prose is not.
