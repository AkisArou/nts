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

interface TypeScriptLibCase extends JetStreamCase {
  inspect(): { diagnostics: string[]; resultFilesCount: number };
}

function isTypeScriptLibCase(value: unknown): value is TypeScriptLibCase {
  return isCase(value) && "inspect" in value && typeof value.inspect === "function";
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

// BEGIN TYPESCRIPT LIB.
{
  const name = "jetstream-typescript-lib";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isTypeScriptLibCase(module));
    checked.add(name);

    test(`${name}: all 118 original files and the complete diagnostic output are preserved`, async () => {
      const input: unknown = await import(new URL(`${name}/input.ts`, root).href);
      const config: unknown = await import(new URL(`${name}/config.ts`, root).href);
      assert.ok(isRecord(input) && isRecord(input.sourceFiles));
      assert.ok(isRecord(config) && isRecord(config.configuration));
      assert.equal(Object.keys(input.sourceFiles).length, 118);
      assert.equal(Object.keys(input.sourceFiles).filter(file => file.startsWith("src/")).length, 16);
      assert.ok(Object.values(input.sourceFiles).every(source => typeof source === "string"));
      const inputSource = readFileSync(new URL(`${name}/input.ts`, root), "utf8");
      const inputDeclaration = "export const sourceFiles: SourceFiles = ";
      const inputStart = inputSource.indexOf(inputDeclaration);
      assert.ok(inputStart >= 0 && inputSource.endsWith(";\n"));
      const inputJSON = inputSource.slice(inputStart + inputDeclaration.length, -2);
      assert.equal(Buffer.byteLength(inputJSON), 3884943);
      assert.equal(sha256(inputJSON), "226f42cad886f188fafb4f070c37c34d50f19b766f5576330beec03b5e7f9e0f");
      const originalInput: unknown = JSON.parse(inputJSON);
      assert.deepEqual(input.sourceFiles, originalInput);
      const configSource = readFileSync(new URL(`${name}/config.ts`, root), "utf8");
      const configDeclaration = "export const configuration: TypeScriptConfiguration = ";
      const configStart = configSource.indexOf(configDeclaration);
      assert.ok(configStart >= 0 && configSource.endsWith(";\n"));
      const configJSON = configSource.slice(configStart + configDeclaration.length, -2);
      assert.equal(Buffer.byteLength(configJSON), 456);
      assert.equal(sha256(configJSON), "b60bfd39b19f6cd444a7a0f4e8933dacd9fb86b0fffebdcdac8a4270cc7a6af7");
      const originalConfig: unknown = JSON.parse(configJSON);
      assert.deepEqual(config.configuration, originalConfig);

      // The original case-sensitive mock host produces these 54 diagnostics.
      // Their full ordered text, including original missing-file diagnostics,
      // is the oracle; the benchmark's unchanged noEmit option produces no files.
      const result = module.inspect();
      assert.equal(result.diagnostics.length, 54);
      assert.equal(result.resultFilesCount, 0);
      const resultJSON = JSON.stringify(result);
      assert.equal(Buffer.byteLength(resultJSON), 17247);
      assert.equal(sha256(resultJSON), "9be28762d730a63e90608ece97056c497b1c4255f13a9bec5f79b14d6495b089");
    });

    test(`${name}: opaque count repeats complete original compilations`, () => {
      assert.equal(module.seed, 1);
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 1068476791);
      assert.equal(module.work(2), 4126486240);
    });
  }
}
// END TYPESCRIPT LIB.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
