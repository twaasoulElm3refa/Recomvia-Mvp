import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
CREATE TABLE support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  access_key_hash TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  authenticated_user_id TEXT,
  question TEXT NOT NULL,
  page_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
sqlite.exec(readFileSync("drizzle/0008_support_ticket_rate_limit.sql", "utf8"));
const indexes = sqlite.prepare("PRAGMA index_list(support_tickets)").all();
assert.ok(indexes.some(row => row.name === "idx_support_tickets_email_created"));

const env = {
  DB: {
    prepare(query) {
      return { bind(...values) {
        return {
          async run() {
            const result = sqlite.prepare(query).run(...values);
            return { meta: { changes: Number(result.changes) } };
          }
        };
      } };
    }
  }
};
const source = readFileSync("db/support.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "cloudflare:workers") return { env };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports);
const { createSupportTicket, SupportRateLimitError } = loaded.exports;
function input(id, email = "sender@example.org") {
  return {
    publicId: id, accessKeyHash: "hashed", requesterName: "Sender",
    requesterEmail: email, authenticatedUserId: null,
    question: "How can I fix my report?", pageUrl: "/contact",
  };
}
test("support rate limit permits five tickets and atomically rejects the sixth", async () => {
  const submissions = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) => createSupportTicket(input("ticket-" + i))),
  );
  assert.equal(submissions.filter(x => x.status === "fulfilled").length, 5);
  const rejected = submissions.filter(x => x.status === "rejected");
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every(x => x.reason instanceof SupportRateLimitError));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_tickets").get().n, 5);
});
test("a different email can submit independently", async () => {
  await createSupportTicket(input("other-email", "second@example.org"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE requester_email = 'second@example.org'").get().n, 1);
});
test("older support messages do not permanently consume the hourly quota", async () => {
  sqlite.prepare("UPDATE support_tickets SET created_at = datetime('now','-2 hours') WHERE public_id = ?").run("ticket-0");
  await createSupportTicket(input("fresh-after-expiration"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE requester_email = 'sender@example.org'").get().n, 6);
});
sqlite.close();
