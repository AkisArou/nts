// Reproduce the per-file report directly from the verified, unedited corpus.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { executeWptFixture, loadWptFixtures } from "../runner.ts";
import type { WptManifest } from "../runner.ts";
import { createCompressionEnvironment, startCompressionResourceServer } from "./environment.ts";

interface ExcludedFixture {
  path: string;
  category: string;
  reason: string;
}
export interface CompressionManifest extends WptManifest {
  excludedFixtures: ExcludedFixture[];
}

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", import.meta.url), "utf8")) as CompressionManifest;
const server = await startCompressionResourceServer();
const files: object[] = [];
const totals = { registered: 0, pass: 0, fail: 0, blocked: 0, notRunFiles: 0, harnessFailures: 0 };
try {
  for (const prepared of loadWptFixtures(root, manifest)) {
    const path = prepared.context.fixture.path;
    try {
      const results = await executeWptFixture(prepared, (reportError) => createCompressionEnvironment(server, reportError));
      const counts = { registered: results.length, pass: 0, fail: 0, blocked: 0 };
      for (const result of results) counts[result.status]++;
      totals.registered += counts.registered;
      totals.pass += counts.pass;
      totals.fail += counts.fail;
      totals.blocked += counts.blocked;
      files.push({ path, ...counts, cases: results.map((result) => ({
        name: result.name, status: result.status,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.error === undefined ? {} : { error: String(result.error) }),
      })) });
      console.error(`${path}: ${counts.pass} pass, ${counts.fail} fail, ${counts.blocked} blocked`);
    } catch (error) {
      totals.harnessFailures++;
      files.push({ path, registered: null, pass: null, fail: null, blocked: null,
        harnessError: String(error),
        ...(error instanceof AggregateError ? { errors: error.errors.map(String) } : {}),
      });
      console.error(`${path}: harness failure: ${String(error)}`);
    }
  }
  for (const fixture of manifest.excludedFixtures) {
    totals.notRunFiles++;
    files.push({ ...fixture, registered: null, pass: null, fail: null, blocked: null, status: "not-run" });
  }
  for (const path of ["media/foo.vtt", "media/test-av-384k-44100Hz-1ch-320x240-30fps-10kfr.webm"]) {
    assert.ok(server.requested.has(path), `unchanged fixture did not fetch ${path}`);
  }
} finally {
  await server.close();
}
const report = { revision: "ae05f5cb53d3e290b91ae1e92069baa188292880", totals, files };
const json = JSON.stringify(report, null, 2) + "\n";
if (process.argv[2] === undefined) process.stdout.write(json);
else writeFileSync(process.argv[2], json);
if (totals.fail !== 0 || totals.harnessFailures !== 0) process.exitCode = 1;
