import zlib from "node:zlib";

/**
 * Plain-text extraction from uploaded résumés, with no third-party parsers.
 *
 * Only enough to index a document: the text feeds a one-off summarization call,
 * it is never shown back to the user verbatim. The original file is kept on disk
 * untouched and that is what gets attached to an email.
 */

const MAX_TEXT = 60_000;

export function documentKind(filename = "") {
  const extension = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (["txt", "md", "markdown"].includes(extension)) return "text";
  if (extension === "rtf") return "rtf";
  if (extension === "docx") return "docx";
  if (extension === "pdf") return "pdf";
  return "unknown";
}

/**
 * @returns {{ text: string, kind: string, extracted: boolean, reason: string }}
 */
export function extractDocumentText(buffer, filename = "") {
  const kind = documentKind(filename);
  try {
    switch (kind) {
      case "text":
        return ok(buffer.toString("utf8"), kind);
      case "rtf":
        return ok(stripRtf(buffer.toString("latin1")), kind);
      case "docx": {
        const xml = readZipEntry(buffer, "word/document.xml");
        if (!xml) return fail(kind, "documento .docx sem word/document.xml");
        return ok(stripDocxXml(xml.toString("utf8")), kind);
      }
      case "pdf":
        // PDF text lives in compressed content streams with font-specific
        // encodings; a correct extractor is out of scope for a local tool.
        return fail(kind, "PDF nao permite extracao confiavel de texto sem dependencia externa");
      default:
        return fail(kind, "formato nao suportado para leitura automatica");
    }
  } catch (error) {
    return fail(kind, `falha ao ler o documento: ${error.message}`);
  }
}

function ok(raw, kind) {
  const text = String(raw || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return fail(kind, "documento vazio");
  return { text: text.slice(0, MAX_TEXT), kind, extracted: true, reason: "" };
}

function fail(kind, reason) {
  return { text: "", kind, extracted: false, reason };
}

/** Turns the WordprocessingML body into readable lines. */
export function stripDocxXml(xml) {
  return String(xml)
    .replace(/<w:p[ >]/g, "\n<w:p ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function stripRtf(raw) {
  return String(raw)
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\[a-z]+-?\d*\s?/gi, "")
    .replace(/[{}]/g, "");
}

/**
 * Minimal ZIP reader: finds one entry by name and inflates it.
 *
 * A .docx is a ZIP archive, and the only entry we need is `word/document.xml`,
 * so this walks the central directory instead of pulling in a zip library.
 */
export function readZipEntry(buffer, wantedName) {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset === -1) return null;

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);

  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name === wantedName) return inflateLocalEntry(buffer, localOffset, compression, compressedSize);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function inflateLocalEntry(buffer, localOffset, compression, compressedSize) {
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;

  // The local header repeats the name/extra lengths, which can differ from the
  // central directory's, so the data offset must be read from here.
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + compressedSize);

  if (compression === 0) return data;
  if (compression === 8) return zlib.inflateRawSync(data);
  return null;
}

function findEndOfCentralDirectory(buffer) {
  // The record is at the end, after a comment of at most 64KB.
  const from = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= from; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}
