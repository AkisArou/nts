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

// BEGIN WSL.
{
  const name = "jetstream-wsl";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isCase(module));
    checked.add(name);
    const wslCase = await import("./cases/jetstream-wsl/case.ts");
    const wsl = await import("./cases/jetstream-wsl/wsl.ts");

    test(`${name}: all 285 original tests and complete-trial allocation counters match upstream`, () => {
      const result = wslCase.inspect();
      assert.equal(result.eBuffers, 97397);
      assert.equal(result.anonymousVariables, 1392);
      assert.equal(result.testNames.length, 285);
      assert.equal(sha256(JSON.stringify(result.testNames)), "e8f89e548db314b0da7e52c9b9344ac016692eab5b4de15a65aa224db84b5571");
    });

    test(`${name}: every original test and standard-library input literal is preserved`, () => {
      const source = readFileSync(new URL(`${name}/wsl.ts`, root), "utf8");
      for (const [file, expectedCount, digest] of [
        ["Test.js", 365, "614ac75f3f5ffe5a28e6c359f3a524facd75b2f04b256c3610afa68f923a7f15"],
        ["StandardLibrary.js", 5, "cb9d3588df9af43c8aa2bd650803f50a8d399edc765d241af0915cd124fba88e"]
      ]) {
        const marker = `// Upstream source: ./WSL/${file}\n`;
        const start = source.indexOf(marker);
        assert.ok(start >= 0);
        const begin = start + marker.length;
        const next = source.indexOf("// Upstream source:", begin);
        const section = source.slice(begin, next < 0 ? source.length : next);
        const literals = section.match(/`(?:\\[\s\S]|[^`\\])*`/g) ?? [];
        assert.equal(literals.length, expectedCount);
        assert.equal(sha256(JSON.stringify(literals)), digest);
      }
    });

    test(`${name}: become changes the original object's prototype and preserves aliases`, () => {
      const receiver = new wsl.Value();
      const target = new wsl.Value();
      const alias = receiver;
      assert.equal(Object.getPrototypeOf(receiver), wsl.Value.prototype);
      receiver.become(target);
      assert.equal(alias, receiver);
      assert.equal(Object.getPrototypeOf(alias), wsl.IdentityExpression.prototype);
      assert.ok(alias instanceof wsl.IdentityExpression);
      assert.equal(alias.target, target);
    });

    test(`${name}: opaque count repeats both complete original phases with fresh trial state`, () => {
      assert.equal(module.seed, 1);
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 3020699);
      assert.equal(module.work(2), 96662368);
      assert.equal(module.work(1), 3020699);
    });
  }
}
// END WSL.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
