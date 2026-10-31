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

// BEGIN FLIGHT PLANNER.
{
  const name = "jetstream-flight-planner";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isRenderCase(module));
    checked.add(name);

    test(`${name}: complete FAA tables and all 100 original expectations are preserved`, () => {
      for (const [file, binding, originalBinding, expected] of [
        ["airways.ts", "export const _faaAirways: Record<string, Airway> =", "var _faaAirways =", "ff760ec8136153a3ccd752e877c6daeb3410ab81c90bc4e26153af3c3635540c"],
        ["waypoints.ts", "export const _faaWaypoints: Record<string, WaypointData> =", "var _faaWaypoints =", "1f6f498992ff133d3401fd007ef79fbaf32160b161a7bc6039c06f1eadf0a92e"],
        ["expectations.ts", "export const expectedFlightPlans: ExpectedFlightPlan[] =", "let expectedFlightPlans =", "aef02aa2021a8bb524fba6c73c9be87e4c77a1659154f947214c3a573fa37a4c"],
      ]) {
        const source = readFileSync(new URL(`${name}/${file}`, root), "utf8");
        assert.ok(source.includes(binding));
        const original = source.slice(source.indexOf("/*")).replace(binding, originalBinding);
        assert.equal(sha256(original), expected);
      }
    });

    test(`${name}: original validation and every calculated route and double match upstream`, async () => {
      const result = module.render(1);
      assert.ok(typeof result === "string");
      assert.equal(result.length, 103018);
      assert.equal(sha256(result), "19c05cce1a65de02b526b0ff2f25c1e211886b83ce2ab9361dc3c4c55e4d9179");
      assert.equal(module.render(2), result);
      const exports: unknown = await import(new URL(`${name}/case.ts`, root).href);
      assert.ok(isRecord(exports));
      assert.ok(typeof exports.details === "function");
      const details: unknown = exports.details(1);
      assert.ok(typeof details === "string");
      assert.equal(details.length, 735677);
      assert.equal(sha256(details), "64b56ceaa99c3b9cafce632dfe91593ad91eb44b5bc2a2661760ac34b66c3c11");
      assert.deepEqual(exports.diagnostics, []);
    });

    test(`${name}: opaque count repeats all five passes over the original routes`, () => {
      assert.equal(module.seed, 1);
      assert.equal(module.render(0), "");
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 4156792939);
      assert.equal(module.work(2), 4168355168);
    });
  }
}
// END FLIGHT PLANNER.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
