import assert from "node:assert/strict";
import test from "node:test";
import { parseModelJson, salvageTruncatedJson } from "./model-json.js";

test("well-formed JSON is parsed unchanged", () => {
  assert.deepEqual(parseModelJson('{"a":1,"b":[1,2]}'), { a: 1, b: [1, 2] });
});

test("an empty response is an error, not an empty object", () => {
  assert.throws(() => parseModelJson(""), /empty/);
  assert.throws(() => parseModelJson("   "), /empty/);
});

test("a response truncated mid-object keeps the complete fields", () => {
  const truncated = '{"profile":{"identity":{"full_name":"Ana","email":"a@x.com"},"professional":{"english_level":"B2"';
  const parsed = parseModelJson(truncated);
  assert.equal(parsed.profile.identity.full_name, "Ana");
  assert.equal(parsed.profile.identity.email, "a@x.com");
});

test("a response truncated mid-array keeps the complete elements", () => {
  const truncated = '{"items":[{"id":1},{"id":2},{"id":';
  const parsed = parseModelJson(truncated);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[1], { id: 2 });
});

test("a truncation inside a string does not corrupt earlier fields", () => {
  const truncated = '{"a":"ok","b":"texto cortado no me';
  const parsed = parseModelJson(truncated);
  assert.equal(parsed.a, "ok");
});

test("braces and quotes inside strings are not counted as structure", () => {
  const value = '{"a":"chaves { } e aspas \\" dentro","b":2}';
  assert.deepEqual(parseModelJson(value), { a: 'chaves { } e aspas " dentro', b: 2 });
});

test("salvage returns null for complete documents and for junk", () => {
  assert.equal(salvageTruncatedJson('{"a":1}'), null);
  assert.equal(salvageTruncatedJson("sem json aqui"), null);
});

test("unrecoverable output still raises instead of returning garbage", () => {
  assert.throws(() => parseModelJson("{{{{"), SyntaxError);
});

test("a JSON preamble is tolerated when the object itself is truncated", () => {
  const parsed = parseModelJson('Aqui esta:\n{"a":1,"b":{"c":2},"d":');
  assert.equal(parsed.a, 1);
  assert.deepEqual(parsed.b, { c: 2 });
});
