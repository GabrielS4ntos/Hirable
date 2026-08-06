import test from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, matchesBlockedDomain } from "./apply-domain.js";

test("normalizes the host", () => {
  assert.equal(registrableDomain("https://WWW.example-website.ai/jobs/123"), "example-website.ai");
  assert.equal(registrableDomain("http://boards.greenhouse.io/acme"), "boards.greenhouse.io");
});

test("a URL that does not parse has no domain", () => {
  assert.equal(registrableDomain("not a url"), null);
  assert.equal(registrableDomain(""), null);
  assert.equal(registrableDomain(null), null);
});

test("blocks the domain and its subdomains", () => {
  assert.equal(matchesBlockedDomain("https://example-website.ai/apply/9", ["example-website.ai"]), "example-website.ai");
  assert.equal(matchesBlockedDomain("https://jobs.example-website.ai/apply/9", ["example-website.ai"]), "example-website.ai");
  assert.equal(matchesBlockedDomain("https://www.example-website.ai/apply/9", ["example-website.ai"]), "example-website.ai");
});

test("does not block a domain that merely contains the string", () => {
  // The reason this module exists: substring matching would block this.
  assert.equal(matchesBlockedDomain("https://naoexample-website.com.br/apply", ["example-website.ai"]), null);
  assert.equal(matchesBlockedDomain("https://example-website.ai.example.com/apply", ["example-website.ai"]), null);
});

test("the blocked entry is normalized the same way as the URL", () => {
  assert.equal(matchesBlockedDomain("https://example-website.ai/x", ["  HTTPS://WWW.example-website.AI/  "]), "example-website.ai");
});

test("an empty or missing list blocks nothing", () => {
  assert.equal(matchesBlockedDomain("https://example-website.ai/x", []), null);
  assert.equal(matchesBlockedDomain("https://example-website.ai/x", null), null);
});

test("an unresolvable URL is not blocked", () => {
  // Failing open is deliberate: these jobs are never sent automatically.
  assert.equal(matchesBlockedDomain("", ["example-website.ai"]), null);
});
