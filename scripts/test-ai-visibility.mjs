import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const output = mkdtempSync(join(tmpdir(), "recomvia-ai-tests-"));
try {
  const compiled = spawnSync(process.execPath, [
    "node_modules/typescript/bin/tsc", "--module", "commonjs", "--moduleResolution", "node",
    "--target", "es2022", "--esModuleInterop", "--skipLibCheck", "--outDir", output,
    "tests/ai-visibility.test.ts",
  ], { stdio: "inherit" });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) process.exitCode = compiled.status ?? 1;
  else {
    writeFileSync(join(output, "package.json"), '{"type":"commonjs"}');
    const tests = spawnSync(process.execPath, ["--test", join(output, "tests/ai-visibility.test.js")], { stdio: "inherit" });
    if (tests.error) throw tests.error;
    if (tests.status !== 0) process.exitCode = tests.status ?? 1;
  }
} finally { rmSync(output, { recursive: true, force: true }); }
