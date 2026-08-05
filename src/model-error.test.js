import assert from "node:assert/strict";
import test from "node:test";
import { describeModelError, isInvalidKeyError, isKeyScopedModelError, isQuotaError, modelErrorText } from "./model-error.js";

const GEMINI_INVALID = new Error(
  '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'
);

test("a provider's JSON failure is unwrapped to its message", () => {
  assert.equal(modelErrorText(GEMINI_INVALID), "API key not valid. Please pass a valid API key.");
  assert.equal(modelErrorText(new Error("plain failure")), "plain failure");
  assert.equal(modelErrorText(null), "");
});

test("a refused credential is recognised across provider wordings", () => {
  for (const message of [
    '{"error":{"message":"API key not valid. Please pass a valid API key."}}',
    "Incorrect API key provided",
    "Request failed with status 401 Unauthorized",
    "PERMISSION_DENIED: caller does not have permission",
    "invalid_api_key"
  ]) {
    assert.equal(isInvalidKeyError(new Error(message)), true, message);
  }
});

test("quota and credentials are both key-scoped, and nothing else is", () => {
  // The distinction that decides whether rotating to the next key can help.
  assert.equal(isKeyScopedModelError(new Error("RESOURCE_EXHAUSTED: Quota exceeded")), true);
  assert.equal(isKeyScopedModelError(GEMINI_INVALID), true);
  assert.equal(isKeyScopedModelError(new Error("models/gemini-9 is not found")), false);
  assert.equal(isKeyScopedModelError(new Error("invalid JSON in response")), false);
});

test("quota is not mistaken for a bad key, or the user is told to fix the wrong thing", () => {
  const quota = new Error("429 Too Many Requests");
  assert.equal(isQuotaError(quota), true);
  assert.equal(isInvalidKeyError(quota), false);
  assert.match(describeModelError(quota, { provider: "Gemini" }), /Cota/);
});

test("the message names the provider, the key and where to fix it", () => {
  const text = describeModelError(GEMINI_INVALID, { provider: "Gemini", keyLabel: "conta pessoal" });
  assert.match(text, /Gemini · conta pessoal/);
  assert.match(text, /Chaves de API/);
  // The provider's JSON must not reach the interface.
  assert.ok(!text.includes("INVALID_ARGUMENT"));
});

test("an unknown failure still says something, and stays short", () => {
  const text = describeModelError(new Error("x".repeat(900)), { provider: "OpenRouter" });
  assert.ok(text.startsWith("OpenRouter: "));
  assert.ok(text.length < 330);
  assert.equal(describeModelError(new Error(""), {}), "falha desconhecida no provider");
});
