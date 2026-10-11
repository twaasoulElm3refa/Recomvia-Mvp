import assert from "node:assert/strict";
import test from "node:test";
import type { StoredScan } from "../db/product";
import { GET, POST } from "../app/api/scans/route";
import { createFixture, state, userA, userB } from "./target-runtime-fixture";

type ApiBody = {
  scan: StoredScan;
  cached: boolean;
  scanId: string;
  status: string;
  candidates?: Array<{ name: string }>;
};
const readBody = (response: Response) => response.json() as Promise<ApiBody>;

const url = "https://profiles.example/ada";
const candidate = {
  kind: "person",
  name: "Ada Example",
  description: "Public researcher",
  category: "Retail analytics",
  aliases: [],
  country: "Global",
  websiteUrl: null,
  sources: [url],
};
function engineReply(content: string, cited = true) {
  return new Response(
    JSON.stringify({
      id: crypto.randomUUID(),
      model: "test/model",
      choices: [
        {
          message: {
            content,
            annotations: cited
              ? [
                  {
                    type: "url_citation",
                    url_citation: { url, title: "Profile" },
                  },
                ]
              : [],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
        cost: 0.001,
        server_tool_use: { web_search_requests: 1 },
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
function request(body: unknown) {
  return new Request("https://recomvia.test/api/scans", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://recomvia.test",
    },
    body: JSON.stringify(body),
  });
}

test("migration keeps old scans, findings, fixes and costs and permits scans without a site", () => {
  const db = createFixture(true);
  assert.equal(
    db.prepare("SELECT readiness_score FROM scans WHERE id='legacy-scan'").get()
      ?.readiness_score,
    81,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM scan_findings").get()?.n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fixes").get()?.n, 1);
  assert.equal(
    db.prepare("SELECT cost_micros FROM cost_ledger").get()?.cost_micros,
    100,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM engine_runs").get()?.n, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM visibility_evidence").get()?.n,
    1,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const siteColumn = db
    .prepare("PRAGMA table_info(scans)")
    .all()
    .find((row) => row.name === "site_id");
  assert.equal(siteColumn?.notnull, 0);
  db.close();
});

test("authenticated API: entity discovery, topic mode, isolation, confirmation, caching and quotas", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let handler: (request: Record<string, unknown>) => Response = () =>
    engineReply("Sample");
  globalThis.fetch = async (_url, init) => {
    calls++;
    return handler(JSON.parse(String(init?.body)));
  };
  try {
    await t.test(
      "resolved person has no fake website or technical score and all costs are stored",
      async () => {
        const db = createFixture();
        calls = 0;
        handler = (body) => {
          const prompt = String(
            (body.messages as { content: string }[])[1].content,
          );
          return engineReply(
            prompt.includes("INPUT_DATA:")
              ? JSON.stringify({ status: "resolved", candidates: [candidate] })
              : prompt.startsWith("What do you know")
                ? "<think>The user wants an identity lookup.</think>Ada Example is a public researcher."
                : "Other Researcher is listed.",
          );
        };
        const res = await POST(
          request({ input: "Ada Example", kind: "person" }),
        );
        assert.equal(res.status, 201);
        const body = await readBody(res);
        assert.equal(body.scan.target!.kind, "person");
        assert.equal(body.scan.siteId, null);
        assert.equal(body.scan.readinessScore, null);
        assert.deepEqual(body.scan.categoryScores, {});
        assert.equal(body.scan.actualVisibilityScore, 0);
        assert.equal(body.scan.engineRuns.length, 3);
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM engine_runs WHERE response_text LIKE '%think%'").get()?.n,
          0,
        );
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM engine_runs WHERE intent != 'identity'").get()?.n,
          2,
        );
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM engine_runs WHERE citations_json LIKE '%profiles.example%'").get()?.n,
          3,
        );
        assert.equal(calls, 4);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM sites").get()?.n, 0);
        assert.equal(
          db.prepare("SELECT SUM(cost_micros) total FROM cost_ledger").get()
            ?.total,
          4000,
        );
        const again = await POST(
          request({ input: "Ada Example", kind: "person" }),
        );
        assert.equal((await readBody(again)).cached, true);
        assert.equal(calls, 4);
        db.close();
      },
    );
    await t.test(
      "namesake choice is server-stored, owner-scoped, and cannot run twice",
      async () => {
        const db = createFixture();
        calls = 0;
        handler = (body) =>
          engineReply(
            String(
              (body.messages as { content: string }[])[1].content,
            ).includes("INPUT_DATA:")
              ? JSON.stringify({
                  status: "ambiguous",
                  candidates: [
                    candidate,
                    { ...candidate, name: "Ada Example II" },
                  ],
                })
              : "Other Researcher is listed.",
          );
        const initial = await POST(request({ input: "Ada", kind: "person" }));
        const body = await readBody(initial);
        assert.equal(initial.status, 202);
        assert.equal(calls, 1);
        state.user = userB;
        assert.equal(
          (
            await GET(
              new Request(
                `https://recomvia.test/api/scans?scan=${body.scanId}`,
              ),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await POST(
              request({ scanId: body.scanId, candidateId: "candidate_1" }),
            )
          ).status,
          409,
        );
        state.user = userA;
        assert.equal(
          (
            await GET(
              new Request(
                `https://recomvia.test/api/scans?scan=${body.scanId}`,
              ),
            )
          ).status,
          200,
        );
        assert.equal(
          (await POST(request({ scanId: body.scanId, candidateId: "forged" })))
            .status,
          409,
        );
        const confirmed = await POST(
          request({
            scanId: body.scanId,
            candidateId: "candidate_2",
            name: "forged name",
          }),
        );
        assert.equal(confirmed.status, 201);
        const scan = (await readBody(confirmed)).scan;
        assert.equal(scan.target!.name, "Ada Example II");
        assert.equal(scan.target!.identityConfirmed, true);
        assert.equal(
          (
            await POST(
              request({ scanId: body.scanId, candidateId: "candidate_2" }),
            )
          ).status,
          409,
        );
        assert.equal(calls, 4);
        db.close();
      },
    );
    await t.test("expired confirmation cannot trigger paid calls", async () => {
      const db = createFixture();
      calls = 0;
      handler = () =>
        engineReply(
          JSON.stringify({ status: "ambiguous", candidates: [candidate] }),
        );
      const initial = await readBody(await POST(request({ input: "Ada" })));
      db.prepare(
        "UPDATE scans SET created_at=datetime('now','-2 hours') WHERE id=?",
      ).run(initial.scanId);
      const res = await POST(
        request({ scanId: initial.scanId, candidateId: "candidate_1" }),
      );
      assert.equal(res.status, 409);
      assert.equal(calls, 1);
      db.close();
    });
    await t.test(
      "topic stores sources with no personal score and requires no website",
      async () => {
        const db = createFixture();
        calls = 0;
        handler = () =>
          engineReply("1. Example Institute — a research source.");
        const result = await POST(
          request({ input: "Retail analytics", kind: "topic" }),
        );
        const body = await readBody(result);
        assert.equal(result.status, 201);
        assert.equal(calls, 2);
        assert.equal(body.scan.actualVisibilityScore, null);
        assert.equal(body.scan.readinessScore, null);
        assert.equal(body.scan.target!.kind, "topic");
        assert.equal(body.scan.actualVisibilityStatus, "measured");
        assert.equal(body.scan.engineRuns[0].citations[0].url, url);
        db.close();
      },
    );
    await t.test(
      "insufficient identity evidence asks for clarification without inventing a score",
      async () => {
        const db = createFixture();
        calls = 0;
        handler = () =>
          engineReply(
            JSON.stringify({ status: "resolved", candidates: [candidate] }),
            false,
          );
        const res = await POST(
          request({ input: "Ada Example", kind: "person" }),
        );
        assert.equal(res.status, 202);
        assert.equal((await readBody(res)).status, "needs_clarification");
        assert.equal(calls, 1);
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM engine_runs").get()?.n,
          0,
        );
        db.close();
      },
    );
    await t.test(
      "no paid calls before authentication or engine configuration",
      async () => {
        const db = createFixture();
        calls = 0;
        state.user = null;
        assert.equal(
          (await POST(request({ input: "Topic", kind: "topic" }))).status,
          401,
        );
        state.user = userA;
        delete state.env.OPENROUTER_API_KEY;
        assert.equal(
          (await POST(request({ input: "Topic", kind: "topic" }))).status,
          503,
        );
        assert.equal(calls, 0);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM scans").get()?.n, 0);
        db.close();
      },
    );
    await t.test(
      "URL-only requests remain supported with an unconfigured engine",
      async () => {
        const db = createFixture();
        delete state.env.OPENROUTER_API_KEY;
        globalThis.fetch = async (remote) => {
          const address = String(remote);
          return new Response(
            address.endsWith("robots.txt")
              ? "User-agent: *\nAllow: /"
              : address.includes("sitemap")
                ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
                : '<html lang="en"><head><title>Example</title><meta name="description" content="Research services"></head><body><h1>Research</h1><p>Useful content.</p></body></html>',
            {
              headers: {
                "Content-Type": address.includes("sitemap")
                  ? "application/xml"
                  : "text/html",
              },
            },
          );
        };
        const res = await POST(request({ url: "https://example.com" }));
        const data = await readBody(res);
        assert.equal(res.status, 201);
        assert.equal(typeof data.scan.readinessScore, "number");
        assert.equal(data.scan.actualVisibilityStatus, "not_configured");
        assert.equal(data.scan.target!.kind, "website");
        db.close();
        globalThis.fetch = async (_url, init) => {
          calls++;
          return handler(JSON.parse(String(init?.body)));
        };
      },
    );
    await t.test(
      "conflicting website identity evidence requires confirmation and remains anchored to the URL",
      async () => {
        const db = createFixture();
        globalThis.fetch = async (remote) => {
          const address = String(remote);
          return new Response(
            address.endsWith("robots.txt")
              ? "User-agent: *\nAllow: /"
              : address.includes("sitemap")
                ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
                : `<html lang="en"><head><title>First Identity</title><meta property="og:site_name" content="Second Identity"></head><body>
                    <script type="application/ld+json">{"@type":"Organization","name":"First Identity","url":"https://same.example/about"}</script>
                    <h1>Research services</h1></body></html>`,
            {
              headers: {
                "Content-Type": address.includes("sitemap")
                  ? "application/xml"
                  : address.endsWith("robots.txt")
                    ? "text/plain"
                    : "text/html",
              },
            },
          );
        };
        const res = await POST(request({ url: "https://same.example" }));
        const data = await readBody(res);
        assert.equal(res.status, 202);
        assert.equal(data.status, "needs_confirmation");
        assert.deepEqual(data.candidates?.map((item) => item.name), [
          "First Identity",
          "Second Identity",
        ]);
        assert.equal(
          db.prepare("SELECT status FROM scans").get()?.status,
          "awaiting_identity",
        );
        assert.equal(db.prepare("SELECT COUNT(*) n FROM engine_runs").get()?.n, 0);
        db.close();
        globalThis.fetch = async (_url, init) => {
          calls++;
          return handler(JSON.parse(String(init?.body)));
        };
      },
    );
    await t.test(
      "quota is reserved atomically before a sixth scan calls a provider",
      async () => {
        const db = createFixture();
        calls = 0;
        handler = () => engineReply("A cited topic answer.");
        for (let i = 0; i < 5; i++)
          assert.equal(
            (await POST(request({ input: `Topic ${i}`, kind: "topic" })))
              .status,
            201,
          );
        const res = await POST(
          request({ input: "Sixth topic", kind: "topic" }),
        );
        assert.equal(res.status, 429);
        assert.equal(calls, 10);
        db.close();
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
