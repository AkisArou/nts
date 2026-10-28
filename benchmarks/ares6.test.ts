// Correctness checks for independently landing ARES-6 rows.
// Upstream: WebKit/WebKit, b64265f153b3178bfb4ca9f51736289f57982fce.
// https://github.com/WebKit/WebKit/tree/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6
// Oracles below were recorded from the pinned, unmodified JavaScript, never
// from the TypeScript ports. The original in-program checks still run too.
// Air excludes the GPL-derived GBEmu recording and tests all three permitted
// original recordings. Basic and Babylon retain their full original inputs.
// Discover directories so an absent, independently landing row is skipped.
// An installed row must import and satisfy its checks; failures are not caught.
// Run with: node --test benchmarks/ares6.test.ts

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import test from "node:test";

interface AresCase {
  seed: number;
  work(n: number): number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAresCase(value: unknown): value is AresCase {
  return isRecord(value) && typeof value.seed === "number" && typeof value.work === "function";
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const casesUrl = new URL("./cases/", import.meta.url);
const cases = readdirSync(casesUrl, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("ares6-"))
  .map((entry) => entry.name)
  .sort();
assert.ok(cases.length > 0, "at least one ARES-6 case must be installed");

const modules = new Map<string, unknown>();
const checked = new Set<string>();
for (const name of cases) {
  const module: unknown = await import(new URL(`${name}/case.ts`, casesUrl).href);
  assert.ok(isAresCase(module), `${name}: missing work/seed exports`);
  modules.set(name, module);

  test(`${name}: independent calls reset state and return a finite checksum`, () => {
    assert.ok(Number.isSafeInteger(module.seed) && module.seed > 0);
    const expected = module.work(module.seed);
    assert.ok(Number.isFinite(expected));
    module.work(module.seed + 1);
    assert.equal(module.work(module.seed), expected);
    assert.equal(module.work(module.seed), expected);
  });
}

// BEGIN AIR: retained in the first shared-test landing.
interface AirObservation {
  hash: number;
  blocks: number;
  slots: number;
  instructions: number;
  frameSize: number;
  callArgAreaSize: number;
  offsets: (number | undefined)[];
}

interface AirCase extends AresCase {
  originalIterations: number;
  originalPayloadCount: number;
  includedPayloadCount: number;
  inspectPayloads(): { name: string; before: AirObservation; after: AirObservation }[];
}

function isAirCase(value: unknown): value is AirCase {
  return isAresCase(value) && "inspectPayloads" in value && typeof value.inspectPayloads === "function" &&
    "originalIterations" in value && typeof value.originalIterations === "number" &&
    "originalPayloadCount" in value && typeof value.originalPayloadCount === "number" &&
    "includedPayloadCount" in value && typeof value.includedPayloadCount === "number";
}

{
  const name = "ares6-air";
  const benchmark = modules.get(name);
  if (benchmark !== undefined) {
    assert.ok(isAirCase(benchmark), `${name}: missing allocator observations`);
    checked.add(name);

    test(`${name}: all permitted original recordings retain their early and late hashes`, () => {
      assert.equal(benchmark.originalIterations, 150);
      assert.equal(benchmark.originalPayloadCount, 4);
      assert.equal(benchmark.includedPayloadCount, 3);
      // Early/late hashes are the source benchmark's own expected values.
      // The remaining observations come from the untouched allocator and
      // complete recording factories at Air/{benchmark,allocate_stack}.js.
      const actual = benchmark.inspectPayloads().map(({ name, before, after }) => ({
        name,
        before: {
          hash: before.hash,
          blocks: before.blocks,
          slots: before.slots,
          instructions: before.instructions,
        },
        after,
      }));
      assert.deepEqual(actual, [
        {
          name: "createPayloadImagingGaussianBlurGaussianBlur",
          before: { hash: 3677819581, blocks: 37, slots: 7, instructions: 189 },
          after: {
            hash: 1252116304, blocks: 37, slots: 7, instructions: 188,
            frameSize: 112, callArgAreaSize: 0,
            offsets: [-80, -88, -96, -100, -88, -112, -40],
          },
        },
        {
          name: "createPayloadTypescriptScanIdentifier",
          before: { hash: 1914852601, blocks: 35, slots: 10, instructions: 170 },
          after: {
            hash: 837339551, blocks: 35, slots: 10, instructions: 166,
            frameSize: 176, callArgAreaSize: 48,
            offsets: [-96, -104, -104, -104, -104, -100, -112, -120, -128, -40],
          },
        },
        {
          name: "createPayloadAirJSACLj8C",
          before: { hash: 1373599940, blocks: 16, slots: 5, instructions: 119 },
          after: {
            hash: 3981283600, blocks: 16, slots: 5, instructions: 117,
            frameSize: 272, callArgAreaSize: 64,
            offsets: [-200, -208, -208, -208, -40],
          },
        },
      ]);
    });

    test(`${name}: repetition preserves each complete original input and native validation`, () => {
      // The native early/late checks execute inside every work iteration.
      assert.equal(benchmark.work(0), 0);
      assert.equal(benchmark.work(1), 1775772159);
      assert.equal(benchmark.work(2), 3551544318);
      assert.equal(benchmark.work(10), 577852406);
    });
  }
}
// END AIR.

// BEGIN ML: add this complete section with the ML case.
interface MLCase extends AresCase {
  originalActivationCount: number;
  render(n: number): unknown;
  renderOriginal(): unknown;
}

function isMLCase(value: unknown): value is MLCase {
  return isAresCase(value) && "originalActivationCount" in value && typeof value.originalActivationCount === "number" &&
    "render" in value && typeof value.render === "function" &&
    "renderOriginal" in value && typeof value.renderOriginal === "function";
}

function quantizedState(value: unknown): string {
  return JSON.stringify(value, (_key: string, field: unknown): unknown => {
    if (typeof field !== "number") return field;
    assert.ok(Number.isFinite(field), "all trained values must be finite");
    return Math.round(field * 1e6);
  });
}

{
  const name = "ares6-ml";
  const benchmark = modules.get(name);
  if (benchmark !== undefined) {
    assert.ok(isMLCase(benchmark), `${name}: missing trained-network observations`);
    checked.add(name);

    test(`${name}: all five original training cases and the full activation sweep match upstream`, () => {
      // Recorded from the unchanged ml/index.js and its original benchmark.js,
      // with the same local fixed RNG supplied to the isolated reference VM.
      // Only the driver's activation-loop bound changes for smaller n. The
      // full n=14 case runs all 70 original networks and their native assertions.
      // Hash every model field, weight, bias, label and final probability;
      // round observed numbers to six decimals to allow math-library low-bit
      // differences without changing any training or prediction arithmetic.
      assert.equal(benchmark.originalActivationCount, 14);
      const oracles = [
        { n: 0, networks: 0, sha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945" },
        { n: 1, networks: 5, sha256: "7a422681622d74ce234ad0ac673dbd1235fa71c08ece0bfc557e1189e918d8f4" },
        { n: 2, networks: 10, sha256: "b6fa7b762800f52e34aca55b7416e132353d46eff1499de6f984f889587a18ba" },
        { n: 14, networks: 70, sha256: "e0e1332cf8cc841d3afe03b13bb9555e829771e5a377595a5df40edcb0848069" },
      ];
      for (const oracle of oracles) {
        const output = oracle.n === 14 ? benchmark.renderOriginal() : benchmark.render(oracle.n);
        assert.ok(Array.isArray(output));
        const observations: unknown[] = output;
        assert.equal(observations.length, oracle.networks);
        assert.equal(sha256(quantizedState(observations)), oracle.sha256, `activation count ${oracle.n}: complete trained state`);
        if (oracle.n === 1) {
          const actual = observations.map((observation) => {
            assert.ok(isRecord(observation) && isRecord(observation.model));
            return {
              name: observation.name,
              iterations: observation.model.iterations,
              hiddenLayers: observation.model.hiddenLayers,
              predictions: observation.predictions,
            };
          });
          assert.deepEqual(actual, [
            { name: "xor", iterations: 40, hiddenLayers: [4], predictions: [false, true, true, true] },
            { name: "and", iterations: 75, hiddenLayers: [3], predictions: [[1, 0], [1, 0], [1, 0], [0, 1]] },
            { name: "or", iterations: 40, hiddenLayers: [4], predictions: [0, 1, 1, 1] },
            { name: "multiclass", iterations: 40, hiddenLayers: [4], predictions: [2, 0, 1, 0] },
            { name: "big", iterations: 60, hiddenLayers: [20], predictions: [[0, 1]] },
          ]);
        }
      }
    });

    test(`${name}: the checksum observes trained weights, biases, probabilities and predictions`, () => {
      // Independently computed from the original VM's observed output, using
      // the documented six-decimal unsigned polynomial checksum.
      assert.equal(benchmark.work(0), 0);
      assert.equal(benchmark.work(1), 272316333);
      assert.equal(benchmark.work(2), 1026121899);
      assert.equal(benchmark.work(14), 1936566119);
      assert.equal(benchmark.work(1), 272316333);
    });
  }
}
// END ML.

test("every installed ARES-6 case has program-specific correctness checks", () => {
  assert.deepEqual(cases.filter((name) => !checked.has(name)), [], "installed rows without independent oracles");
});
