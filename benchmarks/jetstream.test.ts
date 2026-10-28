// Correctness checks for independently landing JetStream 3.0 rows.
// Release: WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b.
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js
// Oracles are recorded from the untouched original programs on Node24.20.0.
// Original in-program validation remains in the ports. Additional full-output
// checks run outside timing, where they cannot change the measured workload.
// Discover installed rows so sibling PRs can land independently; an installed
// row without its own checks is an error, never a silently skipped test.
// Run with the version in .tool-versions: node --test benchmarks/jetstream.test.ts

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

interface JetStreamCase {
  seed: number;
  work(n: number): number | Promise<number>;
}

interface RenderCase extends JetStreamCase {
  render(n: number): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCase(value: unknown): value is JetStreamCase {
  return isRecord(value) && typeof value.seed === "number" && typeof value.work === "function";
}

function isRenderCase(value: unknown): value is RenderCase {
  return isCase(value) && "render" in value && typeof value.render === "function";
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const root = new URL("./cases/", import.meta.url);
const names = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith("jetstream-"))
  .map(entry => entry.name).sort();
assert.ok(names.length > 0, "at least one JetStream case must be installed");

const modules = new Map<string, unknown>();
const checked = new Set<string>();
for (const name of names) {
  const module: unknown = await import(new URL(`${name}/case.ts`, root).href);
  assert.ok(isCase(module), `${name}: missing work/seed exports`);
  modules.set(name, module);
  test(`${name}: repeated complete calls have a stable finite checksum`, async () => {
    assert.ok(Number.isSafeInteger(module.seed) && module.seed > 0);
    const expected = await module.work(module.seed);
    assert.ok(Number.isFinite(expected));
    await module.work(module.seed + 1);
    assert.equal(await module.work(module.seed), expected);
    assert.equal(await module.work(module.seed), expected);
  });
}

// BEGIN JSON STRINGIFY: the first shared-test landing.
{
  const name = "jetstream-json-stringify-inspector";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isRenderCase(module));
    checked.add(name);

    test(`${name}: complete original recording and every output byte are preserved`, () => {
      // These hashes come from the pinned, unmodified payload and native
      // upstream Benchmark.runIteration, not from the port or its observer.
      const source = readFileSync(new URL(`${name}/data.ts`, root), "utf8");
      const declaration = "export const obj: JSONValue[] = ";
      const start = source.indexOf(declaration);
      assert.ok(start >= 0);
      const literal = source.slice(start + declaration.length);
      assert.equal(literal.length, 7334697);
      assert.equal(sha256(literal), "ae148988bd4255b0c273fe31539e4e8a7f90d9b4555da9a90a30180d10cf3c01");
      const result = module.render(1);
      assert.equal(typeof result, "string");
      assert.ok(typeof result === "string");
      assert.equal(result.length, 7333850);
      assert.equal(sha256(result), "f7594b93901565ac9bef3ec74fe2365a568d2514f0480ac3f1cea1613c376b85");
      const records: unknown = JSON.parse(result);
      assert.ok(Array.isArray(records));
      assert.equal(records.length, 846);
      assert.equal(module.render(2), result);
    });

    test(`${name}: opaque count repeats full serialization`, () => {
      assert.equal(module.seed, 1);
      assert.equal(module.render(0), "");
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 500652281);
      assert.equal(module.work(2), 3135971104);
    });
  }
}
// END JSON STRINGIFY.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});





// BEGIN LISTFORMAT INTL: complete original workload checks.
{
  const name = "jetstream-listformat-intl";
  if (modules.has(name)) {
    checked.add(name);
    const intlListFormat = await import("./cases/jetstream-listformat-intl/case.ts");


    test("jetstream-listformat-intl retains the complete original Intl workload", () => {
        assert.equal(intlListFormat.seed, 1);
        assert.equal(intlListFormat.originalIterations, 2);
        assert.equal(intlListFormat.defaultEnabled, false);
        assert.equal(intlListFormat.work(0), 0);
        const snapshot = intlListFormat.render(1);
        assert.equal(snapshot.iterations.length, 1);
        assert.equal(snapshot.expectedMinLength, 506000);
        assert.ok(snapshot.totalLength >= snapshot.expectedMinLength);
        const counts: Record<string, number> = {};
        for (const output of snapshot.iterations[0].outputs)
            counts[output.kind] = (counts[output.kind] ?? 0) + 1;
        assert.deepEqual(counts, {
        "options": 225,
        "format": 2250,
        "parts": 2250
    });
        function fold(previous: number): number {
            let result = (previous * 31 + snapshot.totalLength) >>> 0;
            if (typeof snapshot.lastResult === "string") {
                for (let i = 0; i < snapshot.lastResult.length; ++i)
                    result = (result * 31 + snapshot.lastResult.charCodeAt(i)) >>> 0;
            } else if (typeof snapshot.lastResult === "number") {
                result = (result * 31 + snapshot.lastResult) >>> 0;
            }
            return result;
        }
        assert.equal(intlListFormat.work(1), fold(0));
        assert.equal(intlListFormat.work(2), fold(fold(0)));
        assert.equal(intlListFormat.work(0), 0);
        assert.equal(intlListFormat.work(1), fold(0));
        // Exact oracle text is tied to the recorded Intl data and timezone;
        // all-host original thresholds, full call counts and repeatability above
        // remain checked when running this test on a different host environment.
        if (process.version === "v24.20.0" && process.versions.icu === "78.3" &&
            Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC") {
            assert.equal(snapshot.totalLength, 508496);
            assert.equal(fold(0), 846399107);
            assert.equal(createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
                "00b139e2556a944c4ff9137796af28d8ebe600016687b6571553817da345604b");
        }
    });
  }
}
// END LISTFORMAT INTL.





