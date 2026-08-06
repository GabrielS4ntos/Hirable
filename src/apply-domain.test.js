import test from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, matchesBlockedDomain } from "./apply-domain.js";

test("normalizes the host", () => {
  assert.equal(registrableDomain("https://WWW.Micro1.ai/jobs/123"), "micro1.ai");
  assert.equal(registrableDomain("http://boards.greenhouse.io/acme"), "boards.greenhouse.io");
});

test("a URL that does not parse has no domain", () => {
  assert.equal(registrableDomain("not a url"), null);
  assert.equal(registrableDomain(""), null);
  assert.equal(registrableDomain(null), null);
});

test("blocks the domain and its subdomains", () => {
  assert.equal(matchesBlockedDomain("https://micro1.ai/apply/9", ["micro1.ai"]), "micro1.ai");
  assert.equal(matchesBlockedDomain("https://jobs.micro1.ai/apply/9", ["micro1.ai"]), "micro1.ai");
  assert.equal(matchesBlockedDomain("https://www.micro1.ai/apply/9", ["micro1.ai"]), "micro1.ai");
});

test("does not block a domain that merely contains the string", () => {
  // The reason this module exists: substring matching would block this.
  assert.equal(matchesBlockedDomain("https://naomicro1.com.br/apply", ["micro1.ai"]), null);
  assert.equal(matchesBlockedDomain("https://micro1.ai.example.com/apply", ["micro1.ai"]), null);
});

test("the blocked entry is normalized the same way as the URL", () => {
  assert.equal(matchesBlockedDomain("https://micro1.ai/x", ["  HTTPS://WWW.Micro1.AI/  "]), "micro1.ai");
});

test("an empty or missing list blocks nothing", () => {
  assert.equal(matchesBlockedDomain("https://micro1.ai/x", []), null);
  assert.equal(matchesBlockedDomain("https://micro1.ai/x", null), null);
});

test("an unresolvable URL is not blocked", () => {
  // Failing open is deliberate: these jobs are never sent automatically.
  assert.equal(matchesBlockedDomain("", ["micro1.ai"]), null);
});
