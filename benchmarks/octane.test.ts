// Correctness checks for the independently landing Octane 2.0 rows.
// Upstream source: chromium/octane at 570ad1ccfe86e3eecba0636c8f932ac08edec517.
// https://github.com/chromium/octane/tree/570ad1ccfe86e3eecba0636c8f932ac08edec517
// Use each program's original validation. Additional deterministic oracles
// below were obtained from the pinned, unmodified JavaScript, with base.js's
// ResetRNG for Splay/Crypto; they were not generated from the TypeScript port.
// Discover installed rows so the shared file can land with RayTrace first.
// Run with: node --test benchmarks/octane.test.ts

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import test from "node:test";

interface OctaneCase {
  seed: number;
  work(n: number): number;
}

interface RayTraceCase extends OctaneCase {
  renderScene(): number;
}

interface NavierStokesCase extends OctaneCase {
  simulate(n: number): { getDens(): number[] };
  checkResult(dens: number[]): number;
  checksum(dens: number[]): number;
}

interface SplayCase extends OctaneCase {
  originalSize: number;
  runSplay(n: number): number[];
  validateKeys(keys: number[], size: number): void;
}

interface CryptoCase extends OctaneCase {
  render(n: number): string;
}

interface Box2DCase extends OctaneCase {
  state(steps: number): number[];
}

// Little-endian encoding is explicit, so these independently recorded full
// output oracles do not depend on the machine's byte order or number printing.
function float64Hash(values: number[]): string {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i], true);
  return createHash("sha256").update(bytes).digest("hex");
}

const casesUrl = new URL("./cases/", import.meta.url);
const cases = readdirSync(casesUrl, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("octane-"))
  .map((entry) => entry.name)
  .sort();
assert.ok(cases.length > 0, "at least one Octane case must be installed");

for (const name of cases) {
  const module: OctaneCase = await import(new URL(`${name}/case.ts`, casesUrl).href);

  test(`${name}: independent calls reset state and return a finite checksum`, () => {
    assert.ok(Number.isSafeInteger(module.seed) && module.seed > 0);
    const expected = module.work(module.seed);
    assert.ok(Number.isFinite(expected));
    module.work(module.seed + 1);
    assert.equal(module.work(module.seed), expected);
    assert.equal(module.work(module.seed), expected);
  });

  if (name === "octane-raytrace") {
    const benchmark = module as RayTraceCase;
    test(`${name}: Octane's original scene has diagonal brightness 2321`, () => {
      assert.equal(benchmark.renderScene(), 2321);
      assert.equal(benchmark.work(1), 2321);
      assert.equal(benchmark.work(2), 4642);
      assert.equal(benchmark.work(benchmark.seed), 2321 * benchmark.seed);
    });
  } else if (name === "octane-navier-stokes") {
    const benchmark = module as NavierStokesCase;
    test(`${name}: Octane's fifteenth-frame validation is 77`, () => {
      const density = benchmark.simulate(15).getDens();
      assert.equal(density.length, 130 * 130);
      assert.equal(benchmark.checkResult(density), 77);
      assert.equal(benchmark.checksum(density), 1741150166);
      assert.equal(float64Hash(density), "2431a48b8c7afc575cb8cde9d3cf29c90a1ada00b51362bcd1e00d6afcd558f5");
    });
    test(`${name}: injection schedule and complete field match upstream`, () => {
      // The original injection schedule inserts again on frame seven.
      for (const [frames, checksum] of [[1, 32880630], [2, 3214961372], [6, 2658045723], [7, 1182003149]]) {
        assert.equal(benchmark.work(frames), checksum);
      }
    });
  } else if (name === "octane-splay") {
    const benchmark = module as SplayCase;
    test(`${name}: original 8000-node tree passes Octane teardown`, () => {
      assert.equal(benchmark.originalSize, 8000);
      const keys = benchmark.runSplay(benchmark.originalSize);
      benchmark.validateKeys(keys, benchmark.originalSize);
      assert.equal(keys.length, 8000);
      let hash = 0;
      for (const key of keys) hash = (hash * 31 + key * 0x10000000) >>> 0;
      assert.equal(hash, 2783496346);
    });
    test(`${name}: original size/order checks reject invalid results`, () => {
      assert.throws(() => benchmark.validateKeys([], 1));
      assert.throws(() => benchmark.validateKeys([0.75, 0.25], 2));
      assert.throws(() => benchmark.validateKeys([0.25, 0.25], 2));
      assert.equal(benchmark.work(16), 2166661844);
      assert.equal(benchmark.work(2048), 2002799846);
    });
  } else if (name === "octane-crypto") {
    const benchmark = module as CryptoCase;
    test(`${name}: original RSA bodies decrypt back to the full plaintext`, () => {
      // render runs the original decrypt() plaintext equality check too.
      const firstCiphertext =
        "0599c0900f04d914aa11176b75f1ff8040b99a4cd008dd526d41fff88acc006a0eab4a6ec8d390b300c169c6dc2c23aa7767ba83f336b7f8eaade253c22eb7c78c98881d5e89b2827592f73baea3e32f10b2b1fba83dda854c9c6a96467fca0d1e2f5aa4d595b62f65b2eb258aaef9e73a407511c24085df025de6bbbfb32764";
      assert.equal(benchmark.render(1), firstCiphertext);
      assert.equal(benchmark.work(1), 2404598564);
    });
    test(`${name}: RC4 padding advances within a call and resets between calls`, () => {
      assert.equal(benchmark.work(2), 1396711468);
      assert.equal(benchmark.work(3), 2241573995);
      assert.equal(benchmark.work(1), 2404598564);
    });
  } else if (name === "octane-box2d") {
    const benchmark = module as Box2DCase;
    test(`${name}: complete original world state matches untouched Octane`, () => {
      // This is the one program without an original result assertion. These
      // SHA-256 values cover all 52 bodies' unrounded x, y, angle, vx, vy and
      // angular velocity, in the original body's linked-list traversal order.
      const oracles: [number, string][] = [
        [0, "e5141106620e29929abaf774aafb89b1d8817c2cbfdf01ce06af9bca1f45e8f9"],
        [1, "ea2ec53e5312fa0a306fa81747b7af470a6e813419a6fc95a1f61585b14f25c9"],
        [10, "a8698c9103ffe15b8a087cc6f3758655c25e39e155703d9a67227883b684da6a"],
        [20, "62d34221bd2473a5d72cd30e7d224aa993fbd37c044d983839de919cdf9a52de"],
      ];
      for (const [steps, expected] of oracles) {
        const values = benchmark.state(steps);
        assert.equal(values.length, 52 * 6);
        assert.equal(float64Hash(values), expected);
      }
      assert.equal(benchmark.work(1), 3916658119);
    });
  } else {
    assert.fail(`${name}: missing a program-specific correctness check`);
  }
}
