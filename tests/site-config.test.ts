import assert from "node:assert/strict";
import test from "node:test";
import { normalizedOrigin } from "../lib/site-config";

test("uses the current public origin when unconfigured", () => assert.equal(normalizedOrigin(undefined), "https://recomvia.recomvia.workers.dev"));
test("canonical metadata uses the configured origin without path suffixes", () => assert.equal(normalizedOrigin("https://recomvia.example/path"), "https://recomvia.example"));
test("does not emit credentials or invalid schemes into metadata", () => {
  for (const value of ["javascript:alert(1)", "https://user:password@example.com", "ftp://localhost"]) {
    assert.equal(normalizedOrigin(value), "https://recomvia.recomvia.workers.dev");
  }
});
