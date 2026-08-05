import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./app-store.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "integrations-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const CLIENT = JSON.stringify({ installed: { client_id: "123.apps.googleusercontent.com", client_secret: "segredo-oauth" } });
const TOKEN = { access_token: "ya29.token", refresh_token: "1//refresh", scope: "https://www.googleapis.com/auth/gmail.send" };

function connected(store) {
  store.saveOAuthClient("google", CLIENT);
  store.saveOAuthToken("google", { token: TOKEN, scopes: [TOKEN.scope], account_email: "user@gmail.com" });
}

test("a fresh install never sends email", () => {
  const { store, cleanup } = freshStore();
  try {
    const state = store.emailDeliveryState();
    assert.equal(state.enabled, false);
    assert.equal(state.ready, false);
    assert.equal(state.reason, "client_oauth_nao_configurado");
    assert.equal(store.getNotificationSettings().email_enabled, false);
  } finally {
    cleanup();
  }
});

test("the OAuth client is accepted in installed, web and flat shapes", () => {
  const { store, cleanup } = freshStore();
  try {
    for (const shape of [
      { installed: { client_id: "a", client_secret: "b" } },
      { web: { client_id: "a", client_secret: "b" } },
      { client_id: "a", client_secret: "b" }
    ]) {
      assert.equal(store.saveOAuthClient("google", JSON.stringify(shape)).client_configured, true);
    }
  } finally {
    cleanup();
  }
});

test("an incomplete OAuth client is rejected", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.throws(() => store.saveOAuthClient("google", '{"installed":{"client_id":"a"}}'), /client_secret|inv[aá]lido/i);
    assert.throws(() => store.saveOAuthClient("google", "nao e json"), /inv[aá]lido/i);
  } finally {
    cleanup();
  }
});

test("the interface never receives the client secret or the token", () => {
  const { store, cleanup } = freshStore();
  try {
    connected(store);
    const status = JSON.stringify(store.oauthStatus("google"));
    assert.equal(status.includes("segredo-oauth"), false);
    assert.equal(status.includes("1//refresh"), false);
    assert.equal(status.includes("ya29.token"), false);
    // Apenas uma dica truncada do client id (que nao e segredo) e exposta.
    assert.match(status, /"client_id_hint":"123\.apps\.goo/);
  } finally {
    cleanup();
  }
});

test("connecting requires a saved client", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.throws(() => store.saveOAuthToken("google", { token: TOKEN }), /client OAuth/i);
  } finally {
    cleanup();
  }
});

test("email delivery reports each missing prerequisite in order", () => {
  const { store, cleanup } = freshStore();
  try {
    store.saveOAuthClient("google", CLIENT);
    assert.equal(store.emailDeliveryState().reason, "conta_google_nao_conectada");

    store.saveOAuthToken("google", { token: TOKEN, scopes: [], account_email: "user@gmail.com" });
    assert.equal(store.emailDeliveryState().reason, "destinatario_nao_definido");

    store.setNotificationSettings({ email_to: "user@example.com" });
    const ready = store.emailDeliveryState();
    assert.equal(ready.ready, true);
    assert.equal(ready.enabled, false);
    assert.equal(ready.reason, "envio_desativado_pelo_usuario");

    store.setNotificationSettings({ email_enabled: true });
    assert.equal(store.emailDeliveryState().enabled, true);
  } finally {
    cleanup();
  }
});

test("email cannot be enabled without a connected account", () => {
  const { store, cleanup } = freshStore();
  try {
    const { settings, refused } = store.setNotificationSettings({ email_enabled: true, email_to: "user@example.com" });
    assert.equal(settings.email_enabled, false);
    assert.match(refused.join(" "), /conecte uma conta google/i);
    // The recipient is still saved: a refused flag never discards the rest.
    assert.equal(settings.email_to, "user@example.com");
  } finally {
    cleanup();
  }
});

test("email cannot be enabled without a recipient", () => {
  const { store, cleanup } = freshStore();
  try {
    connected(store);
    const { settings, refused } = store.setNotificationSettings({ email_enabled: true });
    assert.equal(settings.email_enabled, false);
    assert.match(refused.join(" "), /e-mail de destino/i);
  } finally {
    cleanup();
  }
});

test("an invalid recipient is rejected before anything is saved", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.throws(() => store.setNotificationSettings({ email_to: "sem-arroba" }), /inv[aá]lido/i);
    assert.equal(store.getNotificationSettings().email_to, "");
  } finally {
    cleanup();
  }
});

test("the calendar also requires a connected account", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(store.setNotificationSettings({ calendar_enabled: true }).settings.calendar_enabled, false);
    connected(store);
    assert.equal(store.setNotificationSettings({ calendar_enabled: true }).settings.calendar_enabled, true);
  } finally {
    cleanup();
  }
});

test("disconnecting switches email and calendar off", () => {
  const { store, cleanup } = freshStore();
  try {
    connected(store);
    store.setNotificationSettings({ email_to: "user@example.com", email_enabled: true, calendar_enabled: true });
    assert.equal(store.emailDeliveryState().enabled, true);

    store.disconnectOAuth("google");

    const settings = store.getNotificationSettings();
    assert.equal(settings.email_enabled, false);
    assert.equal(settings.calendar_enabled, false);
    assert.equal(store.oauthStatus("google").connected, false);
    // The recipient survives, so reconnecting does not mean retyping it.
    assert.equal(settings.email_to, "user@example.com");
  } finally {
    cleanup();
  }
});

test("a re-consent without refresh_token keeps the stored one", () => {
  const { store, cleanup } = freshStore();
  try {
    connected(store);
    store.saveOAuthToken("google", { token: { access_token: "ya29.novo" }, scopes: ["escopo"] });

    const credentials = store.getOAuthCredentials("google");
    assert.equal(credentials.token.access_token, "ya29.novo");
    assert.equal(credentials.token.refresh_token, "1//refresh");
    assert.equal(store.oauthStatus("google").has_refresh_token, true);
  } finally {
    cleanup();
  }
});

test("integration settings survive a restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "integrations-"));
  const file = path.join(dir, "test.sqlite");
  try {
    const first = new AppStore(file);
    connected(first);
    first.setNotificationSettings({ email_to: "user@example.com", email_enabled: true });
    first.close();

    const second = new AppStore(file);
    assert.equal(second.emailDeliveryState().enabled, true);
    assert.equal(second.oauthStatus("google").account_email, "user@gmail.com");
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no client-facing payload ever contains a credential", () => {
  const { store, cleanup } = freshStore();
  try {
    const apiKey = "AIzaSySUPERSECRETVALUE1234567890";
    store.createApiKey({ provider: "gemini", label: "k", secret: apiKey });
    connected(store);
    store.setNotificationSettings({ email_to: "user@example.com", email_enabled: true });

    // Everything the HTTP layer returns for these routes.
    const payloads = {
      "GET /api/keys": { items: store.listApiKeys() },
      "GET /api/integrations": { google: store.oauthStatus("google"), notifications: store.getNotificationSettings() },
      "email_delivery": (() => {
        const { ready, enabled, reason } = store.emailDeliveryState();
        return { ready, enabled, reason };
      })()
    };

    for (const [route, payload] of Object.entries(payloads)) {
      const json = JSON.stringify(payload);
      for (const secret of [apiKey, "segredo-oauth", "ya29.token", "1//refresh"]) {
        assert.equal(json.includes(secret), false, `${route} vazou ${secret}`);
      }
    }
  } finally {
    cleanup();
  }
});

test("provider errors are redacted before reaching the interface", () => {
  const { store, cleanup } = freshStore();
  try {
    const id = store.createApiKey({ provider: "gemini", label: "k", secret: "AIzaSyREALKEY1234567890abcdef" });
    store.markApiKeyUsed(id, "API key not valid: AIzaSyREALKEY1234567890abcdef rejected");

    const stored = store.listApiKeys()[0].last_error;
    assert.equal(stored.includes("AIzaSyREALKEY1234567890abcdef"), false);
    assert.match(stored, /AIza\*\*\*/);

    connected(store);
    store.setOAuthError("google", "token ya29.SECRETTOKENVALUE123456 expirou");
    assert.equal(store.oauthStatus("google").last_error.includes("SECRETTOKENVALUE"), false);
  } finally {
    cleanup();
  }
});
