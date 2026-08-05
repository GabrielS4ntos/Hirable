import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}

export function sqliteAvailable() {
  return typeof DatabaseSync === "function";
}

export function normalizeSemanticLabel(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-zA-Z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildSemanticFieldText(field, maxInputChars = 500) {
  const label = normalizeSemanticLabel(field?.label);
  const kind = normalizeSemanticLabel(field?.kind || "text");
  const options = (field?.options || [])
    .slice(0, 40)
    .map(normalizeSemanticLabel)
    .filter(Boolean)
    .join(" | ");
  return `field: ${label}\ntype: ${kind}${options ? `\noptions: ${options}` : ""}`.slice(0, Math.max(80, maxInputChars));
}

export function vectorToBuffer(vector) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) return null;
  const values = Float32Array.from(vector);
  if (!values.length || Array.from(values).some((value) => !Number.isFinite(value))) return null;
  return Buffer.from(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
}

export function bufferToVector(blob, dimensions) {
  if (!blob || !Number.isInteger(dimensions) || dimensions <= 0) return null;
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buffer.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) return null;
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  const values = new Float32Array(copy.buffer);
  if (Array.from(values).some((value) => !Number.isFinite(value))) return null;
  return Array.from(values);
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function answerCompatible(field, answer) {
  if (!field || field.kind === "text") return true;
  if (field.kind === "checkbox") return false;
  return (field.options || []).some((option) => String(option).trim().toLowerCase() === String(answer).trim().toLowerCase());
}

export function selectSemanticMatch(matches, settings = {}) {
  const autoThreshold = Number(settings.auto_apply_similarity ?? 0.92);
  const hintThreshold = Number(settings.model_hint_similarity ?? 0.82);
  const margin = Number(settings.minimum_score_margin ?? 0.05);
  if (![autoThreshold, hintThreshold, margin].every(Number.isFinite) || hintThreshold < 0 || autoThreshold > 1 || hintThreshold > autoThreshold || margin < 0) {
    return { auto: null, hints: [], reason: "invalid_thresholds" };
  }
  const eligible = (matches || []).filter((item) => Number.isFinite(item.similarity) && item.similarity >= hintThreshold);
  const first = eligible[0] || null;
  const second = eligible[1] || null;
  const conflictingCloseSecond = Boolean(
    first && second &&
    String(first.answer).trim().toLowerCase() !== String(second.answer).trim().toLowerCase() &&
    first.similarity - second.similarity < margin
  );
  const auto = first && first.similarity >= autoThreshold && !conflictingCloseSecond ? first : null;
  return {
    auto,
    hints: eligible.slice(0, Math.max(1, Number(settings.max_candidates_per_field || 3))),
    reason: auto ? "high_confidence" : (conflictingCloseSecond ? "ambiguous" : "below_auto_threshold")
  };
}

export class SemanticMemory {
  constructor(databasePath) {
    if (!sqliteAvailable()) throw new Error("node:sqlite is unavailable; Node.js 22.5 or newer is required");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS form_answer_memory (
        id TEXT PRIMARY KEY,
        normalized_label TEXT NOT NULL,
        label_sample TEXT NOT NULL,
        field_kind TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        answer TEXT NOT NULL,
        embedding_model TEXT,
        embedding_dimensions INTEGER,
        embedding BLOB,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
        source TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_form_answer_exact
      ON form_answer_memory(normalized_label, field_kind, status);
      CREATE INDEX IF NOT EXISTS idx_form_answer_vectors
      ON form_answer_memory(status, embedding_model, embedding_dimensions);
      CREATE TABLE IF NOT EXISTS runtime_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    try { fs.chmodSync(databasePath, 0o600); } catch {}
  }

  close() {
    this.db.close();
  }

  readRuntimeState() {
    const row = this.db.prepare("SELECT state_json FROM runtime_state WHERE id = 1").get();
    if (!row?.state_json) return null;
    const state = JSON.parse(row.state_json);
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("SQLite runtime state is not an object");
    return state;
  }

  writeRuntimeState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Runtime state must be an object");
    const timestamp = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO runtime_state (id, state_json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(state), timestamp);
    return timestamp;
  }

  getMetadata(key) {
    const row = this.db.prepare("SELECT value FROM local_metadata WHERE key = ?").get(String(key));
    return row?.value ?? null;
  }

  setMetadata(key, value) {
    const timestamp = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO local_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(key), String(value), timestamp);
    return timestamp;
  }

  runtimeStats() {
    const row = this.db.prepare("SELECT LENGTH(state_json) AS state_bytes, updated_at FROM runtime_state WHERE id = 1").get();
    const metadata = this.db.prepare("SELECT COUNT(*) AS count FROM local_metadata").get();
    return {
      state_present: Boolean(row),
      state_bytes: Number(row?.state_bytes || 0),
      state_updated_at: row?.updated_at || null,
      metadata_count: Number(metadata?.count || 0)
    };
  }

  upsert({ label, kind, options = [], answer, vector = null, embeddingModel = null, status = "pending", source = "unknown" }) {
    const normalizedLabel = normalizeSemanticLabel(label);
    const cleanAnswer = String(answer || "").replace(/\s+/g, " ").trim().slice(0, 220);
    if (!normalizedLabel || !cleanAnswer || !["pending", "approved"].includes(status)) return null;
    const vectorBuffer = vectorToBuffer(vector);
    const dimensions = vectorBuffer ? vector.length : null;
    const id = crypto.createHash("sha256").update(JSON.stringify([normalizedLabel, kind, cleanAnswer])).digest("hex");
    const timestamp = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO form_answer_memory (
        id, normalized_label, label_sample, field_kind, options_json, answer,
        embedding_model, embedding_dimensions, embedding, status, source,
        created_at, updated_at, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label_sample = excluded.label_sample,
        options_json = excluded.options_json,
        embedding_model = COALESCE(excluded.embedding_model, form_answer_memory.embedding_model),
        embedding_dimensions = COALESCE(excluded.embedding_dimensions, form_answer_memory.embedding_dimensions),
        embedding = COALESCE(excluded.embedding, form_answer_memory.embedding),
        status = CASE WHEN form_answer_memory.status = 'approved' THEN 'approved' ELSE excluded.status END,
        source = CASE WHEN form_answer_memory.status = 'approved' THEN form_answer_memory.source ELSE excluded.source END,
        updated_at = excluded.updated_at,
        approved_at = CASE
          WHEN form_answer_memory.status = 'approved' THEN form_answer_memory.approved_at
          WHEN excluded.status = 'approved' THEN excluded.approved_at
          ELSE NULL
        END
    `).run(
      id,
      normalizedLabel,
      String(label || "").replace(/\s+/g, " ").trim().slice(0, 300),
      String(kind || "text"),
      JSON.stringify((options || []).slice(0, 80)),
      cleanAnswer,
      vectorBuffer ? embeddingModel : null,
      dimensions,
      vectorBuffer,
      status,
      source,
      timestamp,
      timestamp,
      status === "approved" ? timestamp : null
    );
    return id;
  }

  approve(ids) {
    const statement = this.db.prepare("UPDATE form_answer_memory SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'");
    const timestamp = new Date().toISOString();
    let approvedCount = 0;
    for (const id of new Set(ids || [])) approvedCount += Number(statement.run(timestamp, timestamp, id).changes || 0);
    return approvedCount;
  }

  findExact(field) {
    const rows = this.db.prepare(`
      SELECT id, answer, source, use_count
      FROM form_answer_memory
      WHERE normalized_label = ? AND field_kind = ? AND status = 'approved'
      ORDER BY updated_at DESC
    `).all(normalizeSemanticLabel(field?.label), String(field?.kind || "text"));
    return rows.find((row) => answerCompatible(field, row.answer)) || null;
  }

  search(field, queryVector, embeddingModel, topK = 3) {
    if (!Array.isArray(queryVector) || !queryVector.length || queryVector.some((value) => !Number.isFinite(value))) return [];
    const rows = this.db.prepare(`
      SELECT id, normalized_label, label_sample, field_kind, options_json, answer,
             embedding_dimensions, embedding, source, use_count
      FROM form_answer_memory
      WHERE status = 'approved' AND field_kind = ? AND embedding_model = ? AND embedding_dimensions = ?
    `).all(String(field?.kind || "text"), embeddingModel, queryVector.length);
    return rows
      .filter((row) => answerCompatible(field, row.answer))
      .map((row) => {
        const stored = bufferToVector(row.embedding, row.embedding_dimensions);
        const similarity = stored ? cosineSimilarity(queryVector, stored) : null;
        return similarity === null ? null : {
          id: row.id,
          answer: row.answer,
          label: row.label_sample,
          similarity,
          source: row.source,
          use_count: row.use_count
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, Math.max(1, Number(topK || 3)));
  }

  markUsed(id) {
    if (!id) return;
    this.db.prepare("UPDATE form_answer_memory SET use_count = use_count + 1, updated_at = ? WHERE id = ? AND status = 'approved'")
      .run(new Date().toISOString(), id);
  }

  stats() {
    return this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM form_answer_memory
    `).get();
  }
}
