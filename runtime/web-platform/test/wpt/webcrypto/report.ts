// Reproduce the per-file census with the same verified sources and environment
// as wpt-webcrypto.test.ts. Results are evidence, never expected-failure policy.
import assert from "node:assert/strict";
import { executeWptFixture, loadWptFixtures } from "../runner.ts";
import { createWebCryptoWptEnvironment } from "./environment.ts";
import { readWebCryptoManifest } from "./manifest.ts";

const root = new URL("../", import.meta.url);
const manifest = readWebCryptoManifest();
const prefix = process.env.NTS_WPT_CRYPTO_FIXTURE ?? "";
// Report-only evidence: remove named case exclusions in memory, without changing
// the manifest or gate. Genuine optional-feature statuses and missing file-level
// environments remain explicit; raw failures still make this command exit 1.
const raw = process.env.NTS_WPT_CRYPTO_RAW === "1";
const mode = raw ? "raw" : "scoped";
assert.ok(manifest.fixtures.some((entry) => entry.path.startsWith(prefix)) ||
  manifest.excludedFixtures.some((entry) => entry.path.startsWith(prefix)),
  "The WebCrypto fixture filter must select at least one file");
let failed = false;
for (const entry of manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix))) {
  const fixture = raw ? { ...entry, blockedTests: {} } : entry;
  try {
    const prepared = loadWptFixtures(root, { ...manifest, fixtures: [fixture] })[0]!;
    const results = await executeWptFixture(prepared, createWebCryptoWptEnvironment);
    assert.equal(results.length, fixture.expectedTests, "WPT registration count changed");
    const counts = { pass: 0, fail: 0, blocked: 0 };
    for (const result of results) counts[result.status]++;
    failed ||= counts.fail !== 0;
    process.stdout.write(JSON.stringify({ mode, path: fixture.path, ...counts, results: results.map((result) => ({
      name: result.name, status: result.status, reason: result.reason,
      ...(result.error === undefined ? {} : { error: String(result.error), stack: result.error instanceof Error ? result.error.stack : undefined }),
    })) }) + "\n");
  } catch (error) {
    failed = true;
    const errors = error instanceof AggregateError ? error.errors as unknown[] : [error];
    process.stdout.write(JSON.stringify({ mode, path: fixture.path, pass: null, fail: null, blocked: null,
      harnessErrors: errors.map((item) => ({ error: String(item), stack: item instanceof Error ? item.stack : undefined })),
    }) + "\n");
  }
}
for (const excluded of manifest.excludedFixtures.filter((entry) => entry.path.startsWith(prefix))) {
  process.stdout.write(JSON.stringify({ mode, ...excluded, status: "not-run", pass: null, fail: null, blocked: null }) + "\n");
}
if (failed) process.exitCode = 1;
