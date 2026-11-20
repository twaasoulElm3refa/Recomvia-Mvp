import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const output = mkdtempSync(join(tmpdir(), "recomvia-tests-"));
try {
  const compiled = spawnSync(process.execPath, [
    "node_modules/typescript/bin/tsc", "--module", "commonjs", "--moduleResolution", "node",
    "--target", "es2020", "--esModuleInterop", "--skipLibCheck", "--outDir", output,
    "tests/knowledge-base.test.ts", "tests/site-config.test.ts", "tests/site-locale.test.ts",
  ], { stdio: "inherit" });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) process.exitCode = compiled.status ?? 1;
  else {
    writeFileSync(join(output, "package.json"), '{"type":"commonjs"}');
    for (const name of ["knowledge-base", "site-config", "site-locale"]) {
      const tests = spawnSync(process.execPath, [join(output, `tests/${name}.test.js`)], { stdio: "inherit" });
      if (tests.error) throw tests.error;
      if (tests.status !== 0) { process.exitCode = tests.status ?? 1; break; }
    }
    if (!process.exitCode) {
      const authTests = spawnSync(process.execPath, ["--test", "tests/google-oauth.test.mjs", "tests/production-ux.test.mjs", "tests/support-ticket.test.mjs", "tests/support-ticket-status.test.mjs", "tests/support-ticket-reply.test.mjs", "tests/support-rate-limit.test.mjs", "tests/assistant-request-safety.test.mjs", "tests/scan-request-safety.test.mjs", "tests/monitoring-control-request-safety.test.mjs", "tests/internal-monitor-request-safety.test.mjs", "tests/project-rename-request-safety.test.mjs", "tests/fix-decision-request-safety.test.mjs", "tests/staff-proposal-request-safety.test.mjs", "tests/fix-review-request-safety.test.mjs", "tests/indexing.test.mjs", "tests/blog-routes.test.mjs"], { stdio: "inherit" });
      if (authTests.error) throw authTests.error;
      if (authTests.status !== 0) process.exitCode = authTests.status ?? 1;
    }
  }
} finally { rmSync(output, { recursive: true, force: true }); }
