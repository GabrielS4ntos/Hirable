import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { documentKind, extractDocumentText, readZipEntry, stripDocxXml, stripRtf } from "./document-text.js";

test("the file kind comes from the extension", () => {
  assert.equal(documentKind("cv.docx"), "docx");
  assert.equal(documentKind("CV.PDF"), "pdf");
  assert.equal(documentKind("notes.md"), "text");
  assert.equal(documentKind("old.rtf"), "rtf");
  assert.equal(documentKind("scan.png"), "unknown");
  assert.equal(documentKind(""), "unknown");
});

test("plain text is read as-is and normalized", () => {
  const result = extractDocumentText(Buffer.from("Alex Doe\r\n\r\n\r\n\r\nEngineer   here"), "cv.txt");
  assert.equal(result.extracted, true);
  assert.equal(result.text, "Alex Doe\n\nEngineer here");
});

test("an empty document is a failure, not empty success", () => {
  const result = extractDocumentText(Buffer.from("   "), "cv.txt");
  assert.equal(result.extracted, false);
  assert.match(result.reason, /vazio/);
});

test("unsupported formats say so instead of returning garbage", () => {
  assert.equal(extractDocumentText(Buffer.from("%PDF-1.4 stream"), "cv.pdf").extracted, false);
  assert.equal(extractDocumentText(Buffer.from("binary"), "cv.png").extracted, false);
});

test("WordprocessingML becomes readable lines", () => {
  const xml = "<w:body><w:p><w:r><w:t>Alex</w:t></w:r></w:p><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p></w:body>";
  const text = stripDocxXml(xml).replace(/\n+/g, "\n").trim();
  assert.equal(text, "Alex\nA & B");
});

test("RTF control words are stripped", () => {
  assert.match(stripRtf("{\\rtf1\\ansi Alex\\par Engineer}"), /Alex\s*\n\s*Engineer/);
});

test("a real .docx is unzipped and read", (t) => {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "docx-"));
    fs.mkdirSync(path.join(dir, "src", "word"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "word", "document.xml"),
      '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
        "<w:p><w:r><w:t>Alex Doe</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>Python</w:t></w:r><w:tab/><w:r><w:t>TypeScript</w:t></w:r></w:p>" +
        "</w:body></w:document>"
    );
    execFileSync("zip", ["-q", "-r", path.join(dir, "cv.docx"), "."], { cwd: path.join(dir, "src") });
  } catch {
    t.skip("zip indisponivel neste ambiente");
    return;
  }

  try {
    const buffer = fs.readFileSync(path.join(dir, "cv.docx"));
    assert.ok(readZipEntry(buffer, "word/document.xml"), "a entrada precisa ser localizada");
    assert.equal(readZipEntry(buffer, "nao/existe.xml"), null);

    const result = extractDocumentText(buffer, "cv.docx");
    assert.equal(result.extracted, true);
    assert.match(result.text, /Alex Doe/);
    // Tabs collapse with the rest of the whitespace normalization.
    assert.match(result.text, /Python TypeScript/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt archive fails cleanly", () => {
  const result = extractDocumentText(Buffer.from("nao é um zip"), "cv.docx");
  assert.equal(result.extracted, false);
  assert.ok(result.reason);
});
