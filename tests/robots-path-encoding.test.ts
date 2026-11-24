import assert from "node:assert/strict";
import test from "node:test";
import { runLiveReadinessScan } from "../lib/live-readiness";

test("robots matching compares UTF-8 octets without decoding reserved delimiters", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { label: "literal Arabic rule", path: "/أخبار", rules: "Disallow: /أخبار", blocked: true },
    { label: "lowercase encoded Arabic rule", path: "/أخبار", rules: "Disallow: /%d8%a3%d8%ae%d8%a8%d8%a7%d8%b1", blocked: true },
    { label: "encoded unreserved rule", path: "/news", rules: "Disallow: /%6Eews", blocked: true },
    { label: "encoded unreserved URL", path: "/%6eews", rules: "Disallow: /news", blocked: true },
    { label: "encoded slash is not a path separator", path: "/news%2fprivate", rules: "Disallow: /news/private", blocked: false },
    { label: "encoded slash matches same escaped octet", path: "/news%2fprivate", rules: "Disallow: /news%2Fprivate", blocked: true },
    { label: "encoded wildcard stays literal", path: "/news/today", rules: "Disallow: /news%2A", blocked: false },
    { label: "encoded dollar stays literal", path: "/news%24more", rules: "Disallow: /news%24", blocked: true },
    { label: "unrelated encoded allow does not override block", path: "/أخبار", rules: "Disallow: /أخبار\nAllow: /%d8%a3%d8%ae%d8%b8", blocked: true },
    { label: "allow wins same path in different encoding", path: "/أخبار", rules: "Disallow: /أخبار\nAllow: /%D8%A3%D8%AE%D8%A8%D8%A7%D8%B1", blocked: false },
    { label: "query remains part of match", path: "/search?q=عربي", rules: "Disallow: /search?q=عربي", blocked: true },
    { label: "encoded query delimiter remains distinct", path: "/search%3Fq=abc", rules: "Disallow: /search?q=abc", blocked: false },
  ];
  try {
    for (const entry of cases) {
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        requested.push(url.pathname);
        if (url.pathname === "/robots.txt") {
          return new Response("User-agent: *\n" + entry.rules, { headers: { "Content-Type": "text/plain" } });
        }
        if (url.pathname === "/sitemap.xml") {
          return new Response("<urlset></urlset>", { headers: { "Content-Type": "application/xml" } });
        }
        return new Response("<!doctype html><html><head><title>Robots fixture</title></head><body>Public content</body></html>", { headers: { "Content-Type": "text/html" } });
      };
      const address = "https://robots-octets.example" + entry.path;
      const result = await runLiveReadinessScan(address);
      const finding = result.findings.find((row) => row.code === "robots_policy");
      assert.equal(finding?.status, entry.blocked ? "fail" : "pass", entry.label);
      assert.equal(finding?.awardedPoints, entry.blocked ? 0 : 7, entry.label);
      assert.deepEqual(requested, [new URL(address).pathname, "/robots.txt", "/sitemap.xml"], entry.label);
      assert.equal(result.requestCount, 3, entry.label);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
