import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const state: {
  user: {
    userId: string;
    email: string;
    fullName: string;
    displayName: string;
  } | null;
  env: Record<string, unknown>;
} = { user: null, env: {} };
export const userA = {
  userId: "target-test-a",
  email: "a@example.test",
  fullName: "Tester A",
  displayName: "Tester A",
};
export const userB = {
  userId: "target-test-b",
  email: "b@example.test",
  fullName: "Tester B",
  displayName: "Tester B",
};

export function createFixture(legacy = false, activeSubscription = true) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrations = readdirSync(join(process.cwd(), "drizzle"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations.slice(0, -1))
    sqlite.exec(readFileSync(join(process.cwd(), "drizzle", file), "utf8"));
  if (legacy)
    sqlite.exec(`
    INSERT INTO users (id,email) VALUES ('legacy-user','legacy@example.test');
    INSERT INTO organizations (id,name,owner_user_id) VALUES ('legacy-org','Legacy','legacy-user');
    INSERT INTO sites (id,organization_id,host,normalized_url,display_name) VALUES ('legacy-site','legacy-org','example.com','https://example.com','Legacy');
    INSERT INTO scans (id,organization_id,site_id,requested_by_user_id,methodology_version,language,country,source_url,cache_key,readiness_score,status)
      VALUES ('legacy-scan','legacy-org','legacy-site','legacy-user','readiness-v0.1','en','Global','https://example.com','cache',81,'completed');
    INSERT INTO scan_findings (id,scan_id,code,category,severity,status,title,explanation,evidence,source_url,weight,awarded_points,sort_order)
      VALUES ('legacy-finding','legacy-scan','title','Content readiness','low','pass','Title','Title exists','Evidence','https://example.com',5,5,0);
    INSERT INTO engine_runs (id,scan_id,provider,model,surface_type,prompt_id,intent,prompt,language,country,brand_entity,run_timestamp)
      VALUES ('legacy-run','legacy-scan','Test','legacy-model','api_with_search','prompt-1','discovery','Question','en','Global','Legacy',CURRENT_TIMESTAMP);
    INSERT INTO visibility_evidence (id,scan_id,engine_run_id,evidence_type,excerpt)
      VALUES ('legacy-evidence','legacy-scan','legacy-run','brand_mention','Legacy evidence');
    INSERT INTO fixes (id,organization_id,site_id,scan_id,kind) VALUES ('legacy-fix','legacy-org','legacy-site','legacy-scan','metadata');
    INSERT INTO cost_ledger (id,organization_id,scan_id,category,provider,cost_micros) VALUES ('legacy-cost','legacy-org','legacy-scan','crawl','direct',100);
  `);
  // D1 applies a migration in a transaction with foreign keys enabled.
  sqlite.exec("BEGIN");
  try {
    sqlite.exec(
      readFileSync(join(process.cwd(), "drizzle", migrations.at(-1)!), "utf8"),
    );
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
  if (activeSubscription)
    sqlite.exec(`
      INSERT INTO users (id,email,display_name)
        VALUES ('${userA.userId}','${userA.email}','${userA.displayName}');
      INSERT INTO organizations (id,name,owner_user_id)
        VALUES ('org-target-test-a','Test workspace','${userA.userId}');
      INSERT INTO organization_members (organization_id,user_id,role)
        VALUES ('org-target-test-a','${userA.userId}','owner');
      INSERT INTO subscriptions (id,organization_id,plan,status,current_period_end)
        VALUES ('subscription-target-test-a','org-target-test-a','essential','active','2099-01-01T00:00:00.000Z');
    `);
  class Prepared {
    values: (string | number | null)[] = [];
    constructor(readonly query: string) {}
    bind(...values: (string | number | null)[]) {
      this.values = values;
      return this;
    }
    async run() {
      const result = sqlite.prepare(this.query).run(...this.values);
      return { success: true, meta: { changes: Number(result.changes) } };
    }
    async first(column?: string) {
      const row = sqlite.prepare(this.query).get(...this.values);
      return column ? (row?.[column] ?? null) : row || null;
    }
    async all() {
      return {
        results: sqlite.prepare(this.query).all(...this.values),
        success: true,
      };
    }
  }
  const db = {
    prepare: (query: string) => new Prepared(query),
    async batch(statements: Prepared[]) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  state.user = userA;
  state.env.DB = db;
  state.env.OPENROUTER_API_KEY = "test-only-no-real-key";
  state.env.OPENROUTER_MODEL = "test/model";
  state.env.AI_TEST_MODE = "mock";
  return sqlite;
}
