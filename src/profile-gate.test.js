import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./app-store.js";
import { PROFILE_GATE_CODE, evaluateProfileGate, profileGateState, resetProfileGateCache } from "./profile-gate.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-gate-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const filled = {
  identity: { full_name: "Alex Souza", email: "alex@example.com" },
  professional: { target_roles: ["Backend Developer"] }
};

test("an empty profile closes the gate and names what is missing", () => {
  const gate = evaluateProfileGate({});
  assert.equal(gate.ready, false);
  assert.equal(gate.code, PROFILE_GATE_CODE);
  assert.ok(gate.missing.includes("identity.full_name"));
  assert.ok(gate.missing.includes("professional.target_roles"));
  assert.ok(gate.reason);
});

test("a profile with the required fields opens the gate", () => {
  const gate = evaluateProfileGate(filled);
  assert.equal(gate.ready, true);
  assert.equal(gate.code, null);
  assert.deepEqual(gate.missing, []);
});

test("the onboarding flag alone never opens the gate", () => {
  // A user who skipped fields must stay blocked even if the flag says otherwise.
  const gate = evaluateProfileGate({}, { onboardingComplete: true });
  assert.equal(gate.ready, false);
  assert.equal(gate.onboarding_complete, true);
});

test("saving a complete profile opens the gate for that store", () => {
  const { store, cleanup } = freshStore();
  try {
    resetProfileGateCache();
    assert.equal(profileGateState(store).ready, false);

    store.saveUserProfile({ profile: filled, complete_onboarding: true });
    assert.equal(profileGateState(store).ready, true, "o cache precisa expirar apos a gravacao");
  } finally {
    cleanup();
  }
});

test("the memoized verdict is never shared between two stores", () => {
  const first = freshStore();
  const second = freshStore();
  try {
    first.store.saveUserProfile({ profile: filled, complete_onboarding: true });
    assert.equal(profileGateState(first.store).ready, true);
    assert.equal(profileGateState(second.store).ready, false, "o banco vazio nao pode herdar o veredito");
  } finally {
    first.cleanup();
    second.cleanup();
  }
});
