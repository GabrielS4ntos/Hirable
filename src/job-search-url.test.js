import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchUrl, buildSearchUrls } from "./job-search-url.js";

const OPTIONS = { remoteOnly: true, freshnessDays: 7, excludeExecutive: true };

test("injects sort, freshness and remote parameters", () => {
  const url = new URL(normalizeSearchUrl("https://www.linkedin.com/jobs/search/?keywords=node", OPTIONS));
  assert.equal(url.searchParams.get("sortBy"), "DD");
  assert.equal(url.searchParams.get("f_TPR"), "r604800");
  assert.equal(url.searchParams.get("f_WT"), "2");
  assert.equal(url.searchParams.get("keywords"), "node");
});

test("never sets f_AL: Easy Apply filtering would hide the jobs the digest exists for", () => {
  const url = new URL(normalizeSearchUrl("https://www.linkedin.com/jobs/search/?keywords=node", OPTIONS));
  assert.equal(url.searchParams.get("f_AL"), null);
});

test("a parameter the user pasted is preserved, not overwritten", () => {
  const pasted = "https://www.linkedin.com/jobs/search/?keywords=node&f_WT=1,3&f_TPR=r86400";
  const url = new URL(normalizeSearchUrl(pasted, OPTIONS));
  assert.equal(url.searchParams.get("f_WT"), "1,3");
  assert.equal(url.searchParams.get("f_TPR"), "r86400");
  // sortBy was absent, so it is still injected.
  assert.equal(url.searchParams.get("sortBy"), "DD");
});

test("work mode is left open when the profile is not remote-only", () => {
  const url = new URL(normalizeSearchUrl(
    "https://www.linkedin.com/jobs/search/?keywords=node",
    { ...OPTIONS, remoteOnly: false }
  ));
  assert.equal(url.searchParams.get("f_WT"), null);
});

test("excludes director and executive experience levels", () => {
  const url = new URL(normalizeSearchUrl("https://www.linkedin.com/jobs/search/?keywords=node", OPTIONS));
  assert.equal(url.searchParams.get("f_E"), "2,3,4");
});

test("a non-LinkedIn URL is rejected rather than navigated to", () => {
  assert.throws(() => normalizeSearchUrl("https://example.com/jobs", OPTIONS), /linkedin/i);
});

test("derives one search per target role when no manual search is configured", () => {
  const profile = {
    professional: { target_roles: ["Backend Engineer", "AI Engineer"] },
    work_eligibility: { remote_only: true }
  };
  const config = { jobs_watcher: { searches: [], freshness_days: 7 } };
  const searches = buildSearchUrls(profile, config);

  assert.deepEqual(searches.map((item) => item.name), ["Backend Engineer", "AI Engineer"]);
  for (const search of searches) {
    assert.equal(new URL(search.url).searchParams.get("f_WT"), "2");
    assert.equal(new URL(search.url).searchParams.get("sortBy"), "DD");
  }
  assert.equal(new URL(searches[0].url).searchParams.get("keywords"), "Backend Engineer");
});

test("manual searches replace the derived ones but still get the missing parameters", () => {
  const profile = {
    professional: { target_roles: ["Backend Engineer"] },
    work_eligibility: { remote_only: true }
  };
  const config = {
    jobs_watcher: {
      searches: [{ name: "minha busca", url: "https://www.linkedin.com/jobs/search/?keywords=go" }],
      freshness_days: 7
    }
  };
  const searches = buildSearchUrls(profile, config);

  assert.equal(searches.length, 1);
  assert.equal(searches[0].name, "minha busca");
  assert.equal(new URL(searches[0].url).searchParams.get("keywords"), "go");
  assert.equal(new URL(searches[0].url).searchParams.get("sortBy"), "DD");
});

test("remote_only accepts the Portuguese tristate value", () => {
  const profile = {
    professional: { target_roles: ["Backend"] },
    work_eligibility: { remote_only: "sim" }
  };
  const searches = buildSearchUrls(profile, { jobs_watcher: { searches: [], freshness_days: 7 } });
  assert.equal(new URL(searches[0].url).searchParams.get("f_WT"), "2");
});

test("a profile with no target roles and no manual search yields nothing", () => {
  assert.deepEqual(buildSearchUrls({}, { jobs_watcher: { searches: [], freshness_days: 7 } }), []);
});
