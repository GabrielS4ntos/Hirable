# Configurable pause and i18n implementation plan

1. Add a pure pause module with strict clock validation, cross-midnight evaluation, timezone-aware status/boundary calculation, and unit tests.
2. Add editable pause defaults and an atomic first-run migration that persists the defaults, clears only legacy 08:00-22:00 pipeline windows, and writes a version marker.
3. Pass effective configuration into the scheduler; filter next-run candidates, preserve inbox pairing, re-check queued work before spawn, propagate trigger context, remove the CLI's fixed window and environment bypass, and expose pause state/codes through the API.
4. Add a typed React language provider, complete PT-BR/EN dictionaries, locale persistence, document language updates, and locale-aware formatters.
5. Translate the shell and every page/component. Resolve dynamic labels through stable pipeline/config/profile/status identifiers and prevent raw backend prose from becoming English UI copy.
6. Extend backend and frontend tests for pause validation/migration/scheduling/manual behavior, dictionary parity, stable metadata translation, and locale formatting.
7. Build the production frontend, audit remaining visible literals, restart the persistent service, and walk every route in both languages plus pause save/block/allow flows without LinkedIn side effects.
