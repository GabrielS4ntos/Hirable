# Semantic Form Memory Design

## Goal

Reduce model calls and improve Easy Apply form completion by reusing previously approved answers when a new field is semantically equivalent to a known field. Preserve deterministic safety rules and never infer answers for sensitive questions.

## Chosen approach

Use the built-in Node.js SQLite client for persistence. Store normalized field labels, field kind, exact options, trusted answer, embedding metadata, a compact float vector, and usage counters. Search the small local corpus with cosine similarity in JavaScript. This is a real vector search and avoids FAISS or a native SQLite extension until the corpus grows beyond the scale expected for one LinkedIn account.

Embedding generation uses Gemini's embedding endpoint and the existing round-robin API keys. If embedding generation fails, the pipeline continues safely to the existing form-filling model; it does not fail open.

## Data flow

1. Extract the current fields and run the prompt-injection and sensitive-topic security gate before any filling operation.
2. Existing deterministic rules attempt to fill only fields that passed the gate.
3. Exact approved learned answers are checked.
4. Remaining non-sensitive fields are normalized and embedded.
5. The local SQLite memory is searched by cosine similarity, constrained by field kind and compatible options.
6. A very high-confidence, unambiguous result can be applied automatically.
7. A medium-confidence result is supplied to the existing form-filling model only as a candidate whose value comes from trusted local memory.
8. Model-produced answers are stored as pending after DOM application. They become approved only after the form advances to the next distinct step without a validation error. Deterministic trusted-profile answers may be stored as approved immediately after DOM verification.

## Storage

Database path: `data/semantic-memory.sqlite`.

Table `form_answer_memory` contains:

- stable ID derived from normalized label, kind, and answer;
- normalized and display labels;
- field kind and serialized options;
- sanitized answer;
- embedding model, vector dimensions, and vector BLOB;
- approval flag, source, use count, and timestamps.

The file is local-only and created with restrictive permissions where supported. Existing `state.json` answers produced by `ai_form_filler` are imported only as pending after re-running label, value, kind, source, prompt-injection, and sensitive-topic checks. They are never promoted automatically. Existing entries are not deleted, so rollback remains safe.

Configuration under `jobs_watcher.semantic_memory` defines `enabled`, `database_path`, `embedding_model`, `output_dimensions`, `top_k`, `auto_apply_similarity`, `model_hint_similarity`, `minimum_score_margin`, `max_input_chars`, and `max_candidates_per_field`. The embedding model is configured independently from generative models.

## Safety boundaries

- HTML and full-page text are never embedded.
- Only normalized labels and compact option names enter the embedding request.
- Prompt-injection patterns block the field before deterministic, exact, semantic, or model filling.
- Configured sensitive patterns block filling, lookup, hints, and learning.
- Salary and compensation, work authorization, sponsorship, visa, security clearance, start date, notice period, race or ethnicity, gender, disability, veteran status, age or birth date, criminal history, government identifiers, and identity-document questions are excluded from semantic memory.
- A result is only eligible when field kind matches and select/radio answers exactly match an available option.
- Database content is treated as trusted only when `approved = 1`. Model answers are approved only after DOM application and a confirmed transition to a distinct form step without visible validation errors.
- The model cannot invent a semantic-memory answer; candidates include opaque IDs and trusted values selected before prompt construction.

## Thresholds

- `auto_apply_similarity`: 0.92 by default.
- `model_hint_similarity`: 0.82 by default.
- `minimum_score_margin`: 0.05 by default. Auto-fill is rejected when the top two compatible results have different answers and their score difference is below the margin.
- Below the hint threshold, no memory candidate is used.

Thresholds are configurable. Usage counters and similarity scores are written to audit output without logging the embedding vector.

## Failure handling

- SQLite unavailable or corrupt: emit one operational alert per run and fall back to the existing exact/model flow.
- Embedding API unavailable or rate-limited: skip semantic lookup and learning. Cache embeddings by normalized text during the run and open a per-run circuit breaker after keys are exhausted or the first non-retryable error, avoiding repeated calls.
- Dimension/model mismatch: ignore incompatible vectors rather than comparing them.
- Empty, non-finite, malformed, corrupt, or incompatible vectors are rejected.
- Ambiguous top results: do not auto-fill; pass at most three candidates to the model.
- Model or apply failure: preserve the existing bounded-attempt behavior and stop for review.

Semantic lookup operates on the unresolved fields returned by `extractUnresolvedEasyApplyFields()` after the pre-fill security gate and deterministic phase. This explicitly covers text, select, radio, and checkbox controls; checkbox answers are not learned automatically.

Node.js 22.5 or newer is required for `node:sqlite`. `package.json` declares the engine floor, `validate` performs a preflight import, and the runtime degrades safely when SQLite is unavailable.

## Testing

- Unit-style CLI self-test with synthetic equivalent labels and deterministic vectors.
- SQLite create/upsert/query/use-count tests.
- Sensitive and prompt-injection labels must produce no lookup and no learning.
- Option compatibility tests for radio/select fields.
- Migration test from `state.json` exact learned answers.
- Migration must keep prior AI answers pending.
- Security-gate ordering test proves suspicious or sensitive labels are not filled deterministically.
- Empty/NaN vectors, malformed BLOBs, invalid thresholds, and dimension mismatches are rejected.
- Ambiguous top results with conflicting answers do not auto-fill.
- Embedding failure opens the per-run circuit breaker and does not repeat calls.
- Input is length-limited and tests prove HTML/page text is never embedded.
- SQLite preflight failure falls back safely.
- Existing `npm run validate` and `npm run jobs:mock` must continue to pass.
- Real Playwright check uses `LINKEDIN_STOP_BEFORE_SUBMIT=true` so no application is sent.

## Deferred work

FAISS, sqlite-vec, remote vector databases, multi-worker locking, and cross-device synchronization are intentionally deferred. They add operational complexity without benefit at the expected corpus size.
