import assert from "node:assert/strict";
import test from "node:test";
import { detectSession, isCheckpointUrl, isLoginUrl, readAccountName, sessionRecord } from "./linkedin-session.js";

const LOGGED_IN = [{ name: "li_at" }, { name: "bcookie" }];

test("a feed page with the session cookie counts as connected", () => {
  const result = detectSession({
    url: "https://www.linkedin.com/feed/",
    cookies: LOGGED_IN,
    bodyText: "Olá Gabriel\nSua rede"
  });
  assert.equal(result.connected, true);
  assert.equal(result.state, "connected");
  assert.equal(result.account_name, "Gabriel");
});

test("a redirect to the login page is a missing session", () => {
  const result = detectSession({ url: "https://www.linkedin.com/login", cookies: LOGGED_IN });
  assert.equal(result.connected, false);
  assert.equal(result.state, "disconnected");
  assert.equal(result.reason, "sessao_ausente");
});

test("a checkpoint is someone mid two-step, not a failure", () => {
  // This is what makes the login flow wait instead of giving up on 2FA.
  const result = detectSession({ url: "https://www.linkedin.com/checkpoint/challenge/", cookies: [] });
  assert.equal(result.connected, false);
  assert.equal(result.state, "pending");
  assert.equal(result.reason, "verificacao_em_andamento");
  assert.equal(isCheckpointUrl("https://www.linkedin.com/checkpoint/challenge/"), true);
});

test("a good URL without the cookie is not a session", () => {
  // LinkedIn renders plenty of pages for anonymous visitors; the URL alone lies.
  const result = detectSession({ url: "https://www.linkedin.com/feed/", cookies: [{ name: "bcookie" }] });
  assert.equal(result.connected, false);
  assert.equal(result.reason, "cookie_de_sessao_ausente");
});

test("both pieces of evidence are required", () => {
  assert.equal(detectSession({ url: "https://www.linkedin.com/feed/", cookies: LOGGED_IN }).connected, true);
  assert.equal(detectSession({ url: "https://www.linkedin.com/login", cookies: LOGGED_IN }).connected, false);
  assert.equal(detectSession({ url: "https://www.linkedin.com/feed/", cookies: [] }).connected, false);
});

test("the configured login pattern is what decides, and a broken one fails closed", () => {
  assert.equal(isLoginUrl("https://www.linkedin.com/uas/login", "linkedin.com/login|checkpoint|uas/login"), true);
  assert.equal(isLoginUrl("https://www.linkedin.com/jobs/", "linkedin.com/login|checkpoint|uas/login"), false);
  // An unparseable pattern falls back to the built-in one instead of throwing.
  assert.equal(isLoginUrl("https://www.linkedin.com/login", "([invalid"), true);
});

test("the account name is optional decoration, never a verdict", () => {
  assert.equal(readAccountName("Hi Gabriel Santos, welcome back"), "Gabriel Santos");
  assert.equal(readAccountName("nada reconhecível aqui"), "");
  // No name still connects, because the cookie and the URL already agreed.
  const result = detectSession({ url: "https://www.linkedin.com/feed/", cookies: LOGGED_IN, bodyText: "" });
  assert.equal(result.connected, true);
  assert.equal(result.account_name, "");
});

test("the stored record only ever carries state, never the session itself", () => {
  const record = sessionRecord({ state: "connected", account_name: "Gabriel", at: "2026-08-05T10:00:00.000Z" });
  assert.deepEqual(Object.keys(record).sort(), ["account_name", "checked_at", "connected_at", "last_reason", "state"]);
  assert.equal(record.connected_at, "2026-08-05T10:00:00.000Z");
  assert.equal(JSON.stringify(record).includes("li_at"), false);
});

test("a disconnected record carries no connection timestamp", () => {
  const record = sessionRecord({ state: "expired", reason: "needs_login" });
  assert.equal(record.connected_at, null);
  assert.equal(record.state, "expired");
});

test("an unknown state falls back to disconnected rather than being stored", () => {
  assert.equal(sessionRecord({ state: "whatever" }).state, "disconnected");
});
