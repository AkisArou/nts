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

// BEGIN OFFLINE ASSEMBLER.
{
  const name = "jetstream-offline-assembler";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isRenderCase(module));
    checked.add(name);

    test(`${name}: every original assembly input and all expected lines are preserved`, () => {
      const source = readFileSync(new URL(`${name}/program.ts`, root), "utf8");
      for (const [file, expected] of [
  [
    "LowLevelInterpreter.js",
    "98c70d6544ef24eb3b23165a63b7d4f1e5b1e930cb52f9aec914be7ed595ea90"
  ],
  [
    "LowLevelInterpreter32_64.js",
    "308d51c8dc3ae575b54950009692218dfb7e4c2d584675dda52606d210530b71"
  ],
  [
    "LowLevelInterpreter64.js",
    "3b145cd58f8ef126f48fab83f6a0213dc4319f699250ce548ff1af90060697b7"
  ],
  [
    "InitBytecodes.js",
    "79fbf6324577fe71c3c7671fd219d3661dba6d812dd45afd5d13f71b4d4d489a"
  ],
  [
    "expected.js",
    "97f7ed59fabacedd7b88f8eef1426c96ad4b3199b1a90326bbd45e2ae5463196"
  ]
]) {
        const marker = `// Original source: RexBench/OfflineAssembler/${file}\n`;
        const start = source.indexOf(marker);
        assert.ok(start >= 0);
        const begin = start + marker.length;
        const end = source.indexOf("\n\n// Original source: ", begin);
        assert.ok(end > begin);
        const original = source.slice(begin, end).replace("export const expectedASTDumpedAsLines: string[] =", "let expectedASTDumpedAsLines =");
        assert.equal(sha256(original), expected);
      }
    });

    test(`${name}: every one of the 5669 original AST lines matches upstream`, () => {
      const output = module.render(1);
      assert.ok(typeof output === "string");
      assert.equal(output.length, 178076);
      assert.equal(output.split("\n").length, 5669);
      assert.equal(sha256(output), "28257369b7f67d4df464b4d984dd86d32f9205f0b85476a73ff9ad2db29c0a6d");
      assert.equal(module.render(2), output);
    });

    test(`${name}: dormant source failures are retained rather than repaired`, async () => {
      const source: unknown = await import(new URL(`${name}/program.ts`, root).href);
      assert.ok(isRecord(source));
      const Annotation = source.Annotation;
      assert.ok(typeof Annotation === "function");
      assert.throws(() => Reflect.construct(Annotation, [{}, "local", "test"]), {
        name: "TypeError", message: "Cannot set property codeOrigin of #<Annotation> which has only a getter",
      });
      const parseData = source.parseData;
      assert.ok(typeof parseData === "function");
      for (const value of ["true", "false"])
        assert.throws(() => parseData(`if ${value}\nend\n`, "dormant.asm"), {
          name: "TypeError", message: `${value === "true" ? "True" : "False"}.instance is not a function`,
        });
    });

    test(`${name}: opaque count repeats complete parsing and reset operations`, () => {
      assert.equal(module.seed, 1);
      assert.equal(module.render(0), "");
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 1823231877);
      assert.equal(module.work(2), 2508845216);
    });
  }
}
// END OFFLINE ASSEMBLER.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
