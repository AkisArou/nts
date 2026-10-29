// Reproduce the per-file census with the same verified sources and environment
// as wpt-webcrypto.test.ts. Results are evidence, never expected-failure policy.
import assert from "node:assert/strict";
import { observeWptFixture, loadWptFixtures } from "../runner.ts";
import { createWebCryptoWptEnvironment } from "./environment.ts";
import { readWebCryptoManifest } from "./manifest.ts";
import { publishWptHangs, recordWptHung } from "../hung.ts";

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
let completedFailures = 0;
const hangs: import("../../../../../tooling/gate/step-result.ts").InstrumentResult[] = [];
for (const entry of manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix))) {
  const fixture = raw ? { ...entry, blockedTests: {} } : entry;
  try {
    const prepared = loadWptFixtures(root, { ...manifest, fixtures: [fixture] })[0]!;
    const observation = await observeWptFixture(prepared, createWebCryptoWptEnvironment);
    const { results, errors, hung } = observation;
    if (hung === undefined) assert.equal(results.length, fixture.expectedTests, "WPT registration count changed");
    if (hung !== undefined) { hangs.push(hung.observation); recordWptHung(hung); }
    completedFailures += errors.length;
    failed ||= errors.length !== 0;
    const counts = { pass: 0, fail: 0, blocked: 0 };
    for (const result of results) counts[result.status]++;
    failed ||= counts.fail !== 0;
    completedFailures += counts.fail;
    process.stdout.write(JSON.stringify({ mode, path: fixture.path, ...counts, results: results.map((result) => ({
      name: result.name, status: result.status, reason: result.reason,
      ...(result.error === undefined ? {} : { error: String(result.error), stack: result.error instanceof Error ? result.error.stack : undefined }),
    })), ...(hung === undefined ? {} : { instrument: hung.observation, unfinished: observation.unfinished }),
      ...(errors.length === 0 ? {} : { harnessErrors: errors.map(item => ({ error: String(item), stack: item instanceof Error ? item.stack : undefined })) }),
    }) + "\n");
  } catch (error) {
    failed = true;
    completedFailures++;
    const errors = error instanceof AggregateError ? error.errors as unknown[] : [error];
    process.stdout.write(JSON.stringify({ mode, path: fixture.path, pass: null, fail: null, blocked: null,
      harnessErrors: errors.map((item) => ({ error: String(item), stack: item instanceof Error ? item.stack : undefined })),
    }) + "\n");
  }
}
for (const excluded of manifest.excludedFixtures.filter((entry) => entry.path.startsWith(prefix))) {
  process.stdout.write(JSON.stringify({ mode, ...excluded, status: "not-run", pass: null, fail: null, blocked: null }) + "\n");
}
process.exitCode = publishWptHangs(hangs, completedFailures) || (failed ? 1 : 0);
