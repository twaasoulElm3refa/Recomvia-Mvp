import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "recomvia-entitlement-tests-"));
try {
  const config = join(output, "tsconfig.json");
  writeFileSync(
    config,
    JSON.stringify({
      extends: resolve("tsconfig.json"),
      compilerOptions: {
        noEmit: false,
        module: "commonjs",
        moduleResolution: "node",
        target: "es2022",
        outDir: output,
        rootDir: root,
        incremental: false,
        types: ["node", "@cloudflare/workers-types"],
        typeRoots: [join(root, "node_modules/@types"), join(root, "node_modules")],
      },
      include: [],
      files: [
        join(root, "tests/report-entitlements.test.ts"),
        join(root, "cloudflare-env.d.ts"),
      ],
    }),
  );
  const compile = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", config],
    { stdio: "inherit" },
  );
  if (compile.error) throw compile.error;
  if (compile.status !== 0) process.exitCode = compile.status || 1;
  else {
    writeFileSync(join(output, "package.json"), '{"type":"commonjs"}');
    const mock = join(output, "mock-runtime.cjs");
    writeFileSync(
      mock,
      `const Module = require('node:module'); const path = require('node:path'); const original = Module._load;
      Module._load = function(id, parent, main) {
        if (id === 'cloudflare:workers') return { env: require('./tests/target-runtime-fixture.js').state.env };
        if (id === '@/app/auth') return { getAuthenticatedUser: async () => require('./tests/target-runtime-fixture.js').state.user };
        if (id.startsWith('@/')) return original.call(this, path.join(__dirname, id.slice(2)), parent, main);
        return original.call(this, id, parent, main);
      };`,
    );
    const run = spawnSync(
      process.execPath,
      ["--require", mock, "--test", join(output, "tests/report-entitlements.test.js")],
      { stdio: "inherit", env: { ...process.env, AI_TEST_MODE: "mock" } },
    );
    if (run.error) throw run.error;
    if (run.status !== 0) process.exitCode = run.status || 1;
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
