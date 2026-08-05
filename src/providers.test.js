import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./app-store.js";
import { PROVIDER_IDS, applyRoleChange, getProvider, rolesAfterConfiguring } from "./providers.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "providers-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const state = (entries) => entries.map(([provider, role, configured = true]) => ({ provider, role, configured }));

test("the catalog carries the three providers with suggested models", () => {
  assert.deepEqual(PROVIDER_IDS, ["gemini", "openai", "openrouter"]);
  for (const id of PROVIDER_IDS) {
    const provider = getProvider(id);
    assert.ok(provider.models.length, `${id} precisa de modelos sugeridos`);
    assert.ok(provider.models.includes(provider.default_model));
  }
});

test("OpenAI uses the current GPT-5.6 family with Terra as default", () => {
  const provider = getProvider("openai");
  assert.deepEqual(provider.models, ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]);
  assert.equal(provider.default_model, "gpt-5.6-terra");
});

test("naming a primary demotes the previous one", () => {
  const roles = applyRoleChange(state([["gemini", "primary"], ["openai", "none"], ["openrouter", "none"]]), "openai", "primary");
  assert.equal(roles.openai, "primary");
  assert.notEqual(roles.gemini, "primary");
});

test("with exactly two configured providers, the other becomes fallback", () => {
  const roles = applyRoleChange(
    state([["gemini", "none"], ["openai", "none"], ["openrouter", "none", false]]),
    "gemini",
    "primary"
  );
  assert.equal(roles.gemini, "primary");
  assert.equal(roles.openai, "fallback");
});

test("a third configured provider stays idle until it is given a role", () => {
  const roles = applyRoleChange(
    state([["gemini", "primary"], ["openai", "fallback"], ["openrouter", "none"]]),
    "gemini",
    "primary"
  );
  assert.equal(roles.openrouter, "none");
});

test("promoting the idle provider to fallback displaces the previous fallback", () => {
  const roles = applyRoleChange(
    state([["gemini", "primary"], ["openai", "fallback"], ["openrouter", "none"]]),
    "openrouter",
    "fallback"
  );
  assert.equal(roles.openrouter, "fallback");
  assert.equal(roles.openai, "none");
  assert.equal(roles.gemini, "primary");
});

test("an unconfigured provider can never hold a role", () => {
  const roles = applyRoleChange(
    state([["gemini", "primary"], ["openai", "none", false], ["openrouter", "none", false]]),
    "openai",
    "fallback"
  );
  assert.equal(roles.openai, "none");
});

test("a primary always exists while any provider is configured", () => {
  const roles = applyRoleChange(state([["gemini", "primary"], ["openai", "none"]]), "gemini", "none");
  assert.ok(Object.values(roles).includes("primary"));
});

test("the first provider ever configured becomes the primary", () => {
  const roles = rolesAfterConfiguring(
    state([["gemini", "none"], ["openai", "none", false], ["openrouter", "none", false]]),
    "gemini"
  );
  assert.equal(roles.gemini, "primary");
});

test("the second configured provider becomes the fallback", () => {
  const roles = rolesAfterConfiguring(
    state([["gemini", "primary"], ["openai", "none"], ["openrouter", "none", false]]),
    "openai"
  );
  assert.equal(roles.openai, "fallback");
  assert.equal(roles.gemini, "primary");
});

test("configuring a provider as primary demotes the incumbent", () => {
  const roles = rolesAfterConfiguring(
    state([["gemini", "primary"], ["openai", "none"], ["openrouter", "none", false]]),
    "openai",
    { makePrimary: true }
  );
  assert.equal(roles.openai, "primary");
  assert.equal(roles.gemini, "fallback");
});

test("the store settles roles as keys are added", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(store.primaryProvider(), null);

    store.createApiKey({ provider: "gemini", label: "g", secret: "AIzaKEY1234567" });
    store.settleProviderRoles("gemini");
    assert.equal(store.primaryProvider().id, "gemini");
    assert.equal(store.fallbackProvider(), null);

    store.createApiKey({ provider: "openai", label: "o", secret: "sk-proj-KEY1234" });
    store.settleProviderRoles("openai");
    assert.equal(store.primaryProvider().id, "gemini");
    assert.equal(store.fallbackProvider().id, "openai");

    store.createApiKey({ provider: "openrouter", label: "r", secret: "sk-or-KEY12345" });
    store.settleProviderRoles("openrouter");
    // The third one is idle until asked for.
    assert.equal(store.listProviders().find((item) => item.id === "openrouter").role, "none");
  } finally {
    cleanup();
  }
});

test("a role cannot be given to a provider with no key", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.throws(() => store.setProviderRole("openai", "primary"), /chave/);
  } finally {
    cleanup();
  }
});

test("the model is per provider and defaults to the suggested one", () => {
  const { store, cleanup } = freshStore();
  try {
    const before = store.listProviders().find((item) => item.id === "gemini");
    assert.equal(before.model, getProvider("gemini").default_model);

    store.setProviderModel("gemini", "gemini-3.5-pro");
    assert.equal(store.listProviders().find((item) => item.id === "gemini").model, "gemini-3.5-pro");
    assert.throws(() => store.setProviderModel("gemini", "  "), /modelo/);
    assert.throws(() => store.setProviderModel("inexistente", "x"), /desconhecido/);
  } finally {
    cleanup();
  }
});

test("disabling every key of a provider strips its role", () => {
  const { store, cleanup } = freshStore();
  try {
    const id = store.createApiKey({ provider: "gemini", label: "g", secret: "AIzaKEY1234567" });
    store.settleProviderRoles("gemini");
    assert.equal(store.primaryProvider().id, "gemini");

    store.updateApiKey(id, { enabled: false });
    assert.equal(store.listProviders().find((item) => item.id === "gemini").role, "none");
    assert.equal(store.primaryProvider(), null);
  } finally {
    cleanup();
  }
});

test("an unknown role is rejected with a readable message", () => {
  const { store, cleanup } = freshStore();
  try {
    store.createApiKey({ provider: "gemini", label: "g", secret: "AIzaKEY1234567" });
    assert.throws(() => store.setProviderRole("gemini", "bogus"), /papel deve ser/);
    // Never a raw SQLite constraint error.
    assert.doesNotThrow(() => store.setProviderRole("gemini", "primary"));
  } finally {
    cleanup();
  }
});

test("an upgraded install gets roles from its legacy configuration", async () => {
  const { migrateProviderRolesV1 } = await import("./config.js");
  const { store, cleanup } = freshStore();
  try {
    store.createApiKey({ provider: "gemini", label: "g", secret: "AIzaKEY1234567" });
    store.createApiKey({ provider: "openrouter", label: "r", secret: "sk-or-KEY12345" });
    // Keys existed before roles did: nothing has a role yet.
    assert.equal(store.primaryProvider(), null);

    const config = { model_gate: { provider: "gemini", fallback_provider: "openrouter", job_model: "gemini-3.5-flash" } };
    const result = migrateProviderRolesV1(store, config);

    assert.equal(result.migrated, true);
    assert.equal(store.primaryProvider().id, "gemini");
    assert.equal(store.fallbackProvider().id, "openrouter");
    assert.equal(store.primaryProvider().model, "gemini-3.5-flash");

    // Runs once: a later role change is not undone on the next boot.
    store.setProviderRole("openrouter", "primary");
    assert.equal(migrateProviderRolesV1(store, config).migrated, false);
    assert.equal(store.primaryProvider().id, "openrouter");
  } finally {
    cleanup();
  }
});

test("the migration is a no-op with no keys at all", async () => {
  const { migrateProviderRolesV1 } = await import("./config.js");
  const { store, cleanup } = freshStore();
  try {
    const result = migrateProviderRolesV1(store, {});
    assert.equal(result.migrated, false);
    assert.equal(result.reason, "sem_chaves");
  } finally {
    cleanup();
  }
});

test("every provider accepts multiple keys", () => {
  for (const id of PROVIDER_IDS) {
    assert.equal(getProvider(id).supports_multiple_keys, true, `${id} precisa aceitar varias chaves`);
  }
});

test("all keys of a provider are active and returned in order", () => {
  const { store, cleanup } = freshStore();
  try {
    for (const [provider, secret] of [
      ["openai", "sk-proj-AAAAAAAAAA"],
      ["openai", "sk-proj-BBBBBBBBBB"],
      ["openrouter", "sk-or-CCCCCCCCCC"],
      ["openrouter", "sk-or-DDDDDDDDDD"]
    ]) {
      store.createApiKey({ provider, label: secret.slice(-4), secret });
    }

    assert.deepEqual(store.activeApiKeys("openai").map((key) => key.secret), ["sk-proj-AAAAAAAAAA", "sk-proj-BBBBBBBBBB"]);
    assert.deepEqual(store.activeApiKeys("openrouter").map((key) => key.secret), ["sk-or-CCCCCCCCCC", "sk-or-DDDDDDDDDD"]);

    // A disabled key leaves the rotation without touching the others.
    const first = store.listApiKeys().find((key) => key.provider === "openai");
    store.updateApiKey(first.id, { enabled: false });
    assert.deepEqual(store.activeApiKeys("openai").map((key) => key.secret), ["sk-proj-BBBBBBBBBB"]);
  } finally {
    cleanup();
  }
});

test("the round-robin cursor cycles through every key of a provider", async () => {
  const { SemanticMemory } = await import("./semantic-memory.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rotation-"));
  const file = path.join(dir, "test.sqlite");
  try {
    const store = new AppStore(file);
    for (const label of ["one", "two", "three"]) {
      store.createApiKey({ provider: "openai", label, secret: `sk-proj-${label}-000000` });
    }

    // Same cursor the CLI uses: persisted in local_metadata, per provider.
    const memory = new SemanticMemory(file);
    const pick = (provider) => {
      const keys = store.activeApiKeys(provider);
      const cursorKey = `${provider}_round_robin_index`;
      const previous = memory.getMetadata(cursorKey);
      const nextIndex = ((previous === null ? -1 : Number(previous)) + 1) % keys.length;
      memory.setMetadata(cursorKey, nextIndex);
      return keys[nextIndex].label;
    };

    const seen = Array.from({ length: 7 }, () => pick("openai"));
    assert.equal(new Set(seen).size, 3, "todas as chaves precisam ser usadas");
    assert.deepEqual(seen.slice(0, 3), seen.slice(3, 6), "o ciclo deve se repetir na mesma ordem");

    // Each provider keeps its own cursor: picking gemini must not disturb openai.
    store.createApiKey({ provider: "gemini", label: "g1", secret: "AIzaKEY1234567" });
    assert.equal(pick("gemini"), "g1");
    assert.equal(pick("openai"), seen[1], "o cursor do openai continua de onde parou");

    memory.close();
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
