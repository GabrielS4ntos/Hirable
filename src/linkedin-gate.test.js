import assert from "node:assert/strict";
import test from "node:test";
import { LINKEDIN_GATE_CODE, evaluateLinkedInGate, linkedInGateError } from "./linkedin-gate.js";

test("only a connected session opens the gate", () => {
  const gate = evaluateLinkedInGate({ state: "connected" });
  assert.equal(gate.ready, true);
  assert.equal(gate.code, null);
  assert.equal(gate.reason, null);
});

test("no session at all closes it", () => {
  for (const session of [null, undefined, {}, { state: "disconnected" }]) {
    const gate = evaluateLinkedInGate(session);
    assert.equal(gate.ready, false);
    assert.equal(gate.code, LINKEDIN_GATE_CODE);
  }
});

test("an expired session blocks like a missing one, but says so differently", () => {
  const expired = evaluateLinkedInGate({ state: "expired" });
  const missing = evaluateLinkedInGate({ state: "disconnected" });
  assert.equal(expired.ready, false);
  assert.equal(expired.code, missing.code);
  assert.match(expired.reason, /expirou/i, "quem já esteve conectado precisa saber que caiu");
  assert.notEqual(expired.reason, missing.reason);
});

test("a login in progress is not a usable session", () => {
  // The window is open and nobody has typed anything yet.
  assert.equal(evaluateLinkedInGate({ state: "pending" }).ready, false);
});

test("the error carries the code the API turns into a 409", () => {
  const error = linkedInGateError(evaluateLinkedInGate({ state: "expired" }));
  assert.equal(error.code, LINKEDIN_GATE_CODE);
  assert.match(error.message, /reconecte/i);
});
