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

// BEGIN JSON PARSE: add with the parser case.
{
  const name = "jetstream-json-parse-inspector";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isRenderCase(module));
    checked.add(name);

    test(`${name}: every parsed value and key order matches the complete original output`, () => {
      const result = module.render(1);
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 846);
      const text = JSON.stringify(result);
      assert.equal(text.length, 7333850);
      assert.equal(sha256(text), "f7594b93901565ac9bef3ec74fe2365a568d2514f0480ac3f1cea1613c376b85");
      assert.equal(JSON.stringify(module.render(2)), text);
    });

    test(`${name}: repeated parsing retains the full original input`, () => {
      assert.equal(module.seed, 1);
      assert.equal(module.render(0), null);
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 2215243919);
      assert.equal(module.work(2), 2168328672);
    });
  }
}
// END JSON PARSE.

// BEGIN LAZY COLLECTIONS: add with the lazy iterator case.
{
  const name = "jetstream-lazy-collections";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isRenderCase(module));
    checked.add(name);
    test(`${name}: all nine original pipeline outputs, BigInts and NaN are retained`, () => {
      const result = module.render(1);
      assert.ok(isRecord(result));
      assert.equal(result.totalLength, 635);
      const encoded = JSON.stringify(result, (_key: string, value: unknown): unknown => {
        if (typeof value === "bigint") return { $bigint: value.toString() };
        if (typeof value === "number" && Number.isNaN(value)) return { $number: "NaN" };
        return value;
      });
      assert.equal(sha256(encoded), "1dc06cbe68909d8b8046b88def9ad7171215af0f05a2aab82597246b7fcdbf75");
      assert.equal(module.work(1), 3341292288);
      assert.equal(module.work(2), 3102909952);
      assert.throws(() => module.work(0), /this.totalLength of undefined is invalid/);
    });
  }
}
// END LAZY COLLECTIONS.

// BEGIN SHA256: add with the Stanford SHA256 case.
interface Sha256Case extends JetStreamCase {
  originalRounds: number;
  runIteration(): unknown;
}

function isSha256Case(value: unknown): value is Sha256Case {
  return isCase(value) && "originalRounds" in value && typeof value.originalRounds === "number" &&
    "runIteration" in value && typeof value.runIteration === "function";
}

{
  const name = "jetstream-stanford-crypto-sha256";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isSha256Case(module));
    checked.add(name);
    test(`${name}: all 4500 original rounds retain the source's complete digest`, () => {
      assert.equal(module.originalRounds, 4500);
      const result = module.runIteration();
      assert.ok(Array.isArray(result));
      const words: unknown[] = result;
      const digest = words.map(word => {
        assert.ok(typeof word === "number");
        return (word >>> 0).toString(16).padStart(8, "0");
      }).join("");
      assert.equal(digest, "719043495be84b97fe4f5d7e61c99d6d1ba0cd6974a6b10c684c25a44ddd0c03");
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 3330387455);
      assert.equal(module.work(2), 1798368510);
    });
  }
}
// END SHA256.

// BEGIN SYNC FS: add with the in-memory filesystem case.
{
  const name = "jetstream-sync-fs";
  const module = modules.get(name);
  if (module !== undefined) {
    assert.ok(isRenderCase(module));
    checked.add(name);
    test(`${name}: all names, topology and surviving file bytes match upstream`, () => {
      const result = module.render(1);
      assert.ok(isRecord(result));
      assert.equal(result.totalFileCount, 1108);
      assert.equal(result.totalDirCount, 5000);
      assert.equal(result.lastFileHash, 436945457);
      assert.equal(sha256(JSON.stringify(result)), "fca540e3753aea7836cbe9431c908f33cfd8e05f190bc4ecac71334bebebdb46");
      assert.equal(module.work(1), 438165245);
      assert.equal(module.work(2), 439385033);
      assert.throws(() => module.work(0), /Invalid file hash: undefined/);
    });
  }
}
// END SYNC FS.

// BEGIN HASH MAP: add with the hash-map case.
{
  const name = "jetstream-hash-map";
  if (modules.has(name)) {
    checked.add(name);
    const { HashMap, render, seed, work } = await import("./cases/jetstream-hash-map/case.ts");
    // Proposed additions to the coordinator-owned JetStream test file.
    
    test('hash-map retains all original full-input sums', () => {
      assert.deepEqual(render(1), { lookupSum: 18900000, keySum: 4049955000, valueSum: 3780000 });
    });
    
    test('hash-map repeats complete iterations with independent checksums', () => {
      assert.equal(seed, 1);
      assert.equal(work(0), 0);
      assert.equal(work(1), 1981364232);
      assert.equal(work(2), 3067650816);
      assert.equal(work(1), 1981364232);
    });
    
    test('hash-map preserves sparse initialization and original dormant failures', () => {
      const map = new HashMap(31, 0.5);
      assert.equal(map._capacity, 32);
      assert.equal(map._elementData.length, 1);
      assert.equal(map._threshold, 0);
      map.put('Aa', 1);
      map.put('BB', 2);
      assert.equal(map.get('Aa'), 1);
      assert.equal(map.get('BB'), 2);
      assert.throws(() => map.keySet().iterator().next(), { name: 'TypeError', message: 'this.makeNext is not a function' });
      assert.throws(() => map.values().iterator().next(), { name: 'TypeError', message: 'this.makeNext is not a function' });
      assert.throws(() => map.keySet().contains('Aa'), { name: 'TypeError', message: 'this._associatedMap.contains is not a function' });
      assert.throws(() => map.clone(), { name: 'ReferenceError', message: 'put is not defined' });
    });
  }
}
// END HASH MAP.

// BEGIN CRYPTO MD5 SP: complete original workload checks.
{
  const name = "jetstream-crypto-md5-sp";
  if (modules.has(name)) {
    checked.add(name);
    // Proposed additions to the coordinator-owned JetStream test.
    // This typed transcription is derived from the RSA Data Security, Inc. MD5 Message-Digest Algorithm.
    const { hex_md5, hex_hmac_md5, md5_vm_test, render, observation, seed, work } = await import("./cases/jetstream-crypto-md5-sp/case.ts");

    test('crypto-md5-sp retains the complete input and original inner repetitions', () => {
      assert.equal(render(1), 'a831e91e0f70eddcb70dc61c6f82f6cd');
      assert.deepEqual(observation(), { digest: 'a831e91e0f70eddcb70dc61c6f82f6cd', inputLength: 15824 });
      assert.equal(md5_vm_test(), true);
    });

    test('crypto-md5-sp retains the original digest and HMAC helpers', () => {
      assert.equal(hex_md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
      assert.equal(hex_hmac_md5('key', 'The quick brown fox jumps over the lazy dog'), '80070713463e7749b90c2dc24911e275');
    });

    test('crypto-md5-sp repeats complete original iterations', () => {
      assert.equal(seed, 1);
      assert.equal(work(0), 0);
      assert.equal(work(1), 1301045875);
      assert.equal(work(2), 2978762336);
      assert.equal(work(1), 1301045875);
    });
  }
}
// END CRYPTO MD5 SP.

// BEGIN CRYPTO SHA1 SP: complete original workload checks.
{
  const name = "jetstream-crypto-sha1-sp";
  if (modules.has(name)) {
    checked.add(name);
    // Proposed additions to the coordinator-owned JetStream test.
    // This is a typed transcription of Paul Johnston's JavaScript SHA-1 implementation and the complete SunSpider workload.
    const { hex_sha1, hex_hmac_sha1, sha1_vm_test, render, observation, seed, work } = await import("./cases/jetstream-crypto-sha1-sp/case.ts");

    test('crypto-sha1-sp retains the complete input and original inner repetitions', () => {
      assert.equal(render(1), '2524d264def74cce2498bf112bedf00e6c0b796d');
      assert.deepEqual(observation(), { digest: '2524d264def74cce2498bf112bedf00e6c0b796d', inputLength: 10064 });
      assert.equal(sha1_vm_test(), true);
    });

    test('crypto-sha1-sp retains the original digest and HMAC helpers', () => {
      assert.equal(hex_sha1('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
      assert.equal(hex_hmac_sha1('key', 'The quick brown fox jumps over the lazy dog'), 'de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9');
    });

    test('crypto-sha1-sp repeats complete original iterations', () => {
      assert.equal(seed, 1);
      assert.equal(work(0), 0);
      assert.equal(work(1), 2278502454);
      assert.equal(work(2), 4192601792);
      assert.equal(work(1), 2278502454);
    });
  }
}
// END CRYPTO SHA1 SP.

// BEGIN PBKDF2: add with the stanford-crypto-pbkdf2 case.
{
  const name = "jetstream-stanford-crypto-pbkdf2";
  if (modules.has(name)) {
    checked.add(name);
    const { seed, originalCount, runIteration, work } = await import("./cases/jetstream-stanford-crypto-pbkdf2/case.ts");
    const { pbkdf2, hex } = await import("./cases/jetstream-stanford-crypto-pbkdf2/pbkdf2.ts");
    // Independent original values; root retains absent-directory gating/import policy.
    
    test("JetStream PBKDF2 retains its original full input and validation", () => {
      assert.equal(seed, 1);
      assert.equal(originalCount, 2048);
      assert.equal(runIteration(), "5436c4c0d73e425a521f4a5a13e0fffe5cd957a823f435385fa0a75068a26803");
    });
    
    test("JetStream PBKDF2 repeats complete iterations with stable checksums", () => {
      assert.equal(work(0), 0);
      assert.equal(work(1), 1028499425);
      assert.equal(work(2), 3475752898);
      assert.equal(work(1), 1028499425);
    });
    
    test("JetStream PBKDF2 retains original optional-length and error behavior", () => {
      assert.equal(hex.fromBits(pbkdf2("password", "salt", 2, 256)), "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43");
      assert.throws(() => pbkdf2("password", "salt", -1), error => String(error) === "INVALID: invalid params to pbkdf2");
    });
  }
}
// END PBKDF2.

// BEGIN REGEXP OCTANE: add with the complete recorded RegExp workload.
{
  const name = "jetstream-regexp-octane";
  if (modules.has(name)) {
    checked.add(name);
    const { seed, work, render } = await import("./cases/jetstream-regexp-octane/case.ts");
    test(`${name}: all twelve blocks retain the original five checksum assertions`, () => {
      assert.equal(seed, 1);
      assert.deepEqual(render(2), [1666156, 1666156]);
      assert.equal(work(0), 0);
      assert.equal(work(1), 1666156);
      assert.equal(work(2), 53316992);
    });
  }
}
// END REGEXP OCTANE.

// BEGIN VALIDATORJS: complete original workload checks.
{
  const name = "jetstream-validatorjs";
  if (modules.has(name)) {
    checked.add(name);
    // Proposed addition to the parent-owned shared JetStream benchmark test.
    const {EXPECTED_ASSERTION_COUNT, originalIterations, render, seed, work} = await import("./cases/jetstream-validatorjs/case.ts");

    test('JetStream validatorjs runs all original 10,114 assertions', () => {
      assert.equal(seed, 1);
      assert.equal(originalIterations, 120);
      assert.equal(EXPECTED_ASSERTION_COUNT, 10114);
      assert.equal(work(1), 10114);
      assert.equal(work(2), 323648);
      assert.deepEqual(render(2), {assertionCount: 10114, iterations: [10114, 10114]});
      assert.throws(() => work(0), /Expected 10114 assertions, but got 0/);
      assert.equal(work(1), 10114);
    });
  }
}
// END VALIDATORJS.

// BEGIN STRING UNPACK CODE SP: complete original workload checks.
{
  const name = "jetstream-string-unpack-code-sp";
  if (modules.has(name)) {
    checked.add(name);
    const unpack = await import("./cases/jetstream-string-unpack-code-sp/case.ts");

    test("jetstream-string-unpack-code-sp preserves all four complete packed inputs", () => {
        assert.equal(unpack.seed, 1);
        assert.equal(unpack.originalIterations, 120);
        assert.equal(unpack.work(0), 0);
        assert.equal(unpack.work(1), 511508);
        assert.equal(unpack.work(2), 16368256);
        assert.equal(unpack.work(1), 511508);
        const outputs = unpack.render(1);
        assert.equal(outputs.length, 8);
        assert.deepEqual(outputs.map(({library, text}) => ({library, length: text.length,
            sha256: createHash("sha256").update(text).digest("hex")})),
        [0, 1].flatMap(() => [
            {library: "MochiKit", length: 106415, sha256: "dc5f4ab3f3cebcaf012e13e740b1e549b21e26e35e3d04cf8b32e7e0f2f74a30"},
            {library: "JQuery", length: 39024, sha256: "c0163714cd1b31332a7af9809bc915843c91ae164c612458df00498abcd4aad3"},
            {library: "Dojo", length: 72458, sha256: "9f43f41c56fc9cf476d55b74b8ae8ee01878deaddbe1e6586dd90021b7a4fbfe"},
            {library: "Prototype", length: 37857, sha256: "5956b78dc5ef8b5a87df8aa9ef85c7ec544a15973c1bfc9ccbf0264c8df56600"},
        ]));
    });
  }
}
// END STRING UNPACK CODE SP.

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

// BEGIN RELATIVETIMEFORMAT INTL: complete original workload checks.
{
  const name = "jetstream-relativetimeformat-intl";
  if (modules.has(name)) {
    checked.add(name);
    const intlRelativeTimeFormat = await import("./cases/jetstream-relativetimeformat-intl/case.ts");


    test("jetstream-relativetimeformat-intl retains the complete original Intl workload", () => {
        assert.equal(intlRelativeTimeFormat.seed, 1);
        assert.equal(intlRelativeTimeFormat.originalIterations, 2);
        assert.equal(intlRelativeTimeFormat.defaultEnabled, false);
        assert.equal(intlRelativeTimeFormat.work(0), 0);
        const snapshot = intlRelativeTimeFormat.render(1);
        assert.equal(snapshot.iterations.length, 1);
        assert.equal(snapshot.expectedMinLength, 432000);
        assert.ok(snapshot.totalLength >= snapshot.expectedMinLength);
        const counts: Record<string, number> = {};
        for (const output of snapshot.iterations[0].outputs)
            counts[output.kind] = (counts[output.kind] ?? 0) + 1;
        assert.deepEqual(counts, {
        "options": 150,
        "format": 15000,
        "parts": 15000
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
        assert.equal(intlRelativeTimeFormat.work(1), fold(0));
        assert.equal(intlRelativeTimeFormat.work(2), fold(fold(0)));
        assert.equal(intlRelativeTimeFormat.work(0), 0);
        assert.equal(intlRelativeTimeFormat.work(1), fold(0));
        // Exact oracle text is tied to the recorded Intl data and timezone;
        // all-host original thresholds, full call counts and repeatability above
        // remain checked when running this test on a different host environment.
        if (process.version === "v24.20.0" && process.versions.icu === "78.3" &&
            Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC") {
            assert.equal(snapshot.totalLength, 434328);
            assert.equal(fold(0), 98711746);
            assert.equal(createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
                "9e0b761b97455f271c97d71e6479482ad7fe7425d9bcb6f2433f5bd25a2a179e");
        }
    });
  }
}
// END RELATIVETIMEFORMAT INTL.

// BEGIN NUMBERFORMAT INTL: complete original workload checks.
{
  const name = "jetstream-numberformat-intl";
  if (modules.has(name)) {
    checked.add(name);
    const intlNumberFormat = await import("./cases/jetstream-numberformat-intl/case.ts");


    test("jetstream-numberformat-intl retains the complete original Intl workload", () => {
        assert.equal(intlNumberFormat.seed, 1);
        assert.equal(intlNumberFormat.originalIterations, 2);
        assert.equal(intlNumberFormat.defaultEnabled, false);
        assert.equal(intlNumberFormat.work(0), 0);
        const snapshot = intlNumberFormat.render(1);
        assert.equal(snapshot.iterations.length, 1);
        assert.equal(snapshot.expectedMinLength, 40000);
        assert.ok(snapshot.totalLength >= snapshot.expectedMinLength);
        const counts: Record<string, number> = {};
        for (const output of snapshot.iterations[0].outputs)
            counts[output.kind] = (counts[output.kind] ?? 0) + 1;
        assert.deepEqual(counts, {
        "options": 200,
        "format": 2000,
        "parts": 2000
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
        assert.equal(intlNumberFormat.work(1), fold(0));
        assert.equal(intlNumberFormat.work(2), fold(fold(0)));
        assert.equal(intlNumberFormat.work(0), 0);
        assert.equal(intlNumberFormat.work(1), fold(0));
        // Exact oracle text is tied to the recorded Intl data and timezone;
        // all-host original thresholds, full call counts and repeatability above
        // remain checked when running this test on a different host environment.
        if (process.version === "v24.20.0" && process.versions.icu === "78.3" &&
            Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC") {
            assert.equal(snapshot.totalLength, 40860);
            assert.equal(fold(0), 2638717745);
            assert.equal(createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
                "cddb4f24a937c82cc6b94c322d449940297a74f44a532d1d027ba43d8a3eeb7c");
        }
    });
  }
}
// END NUMBERFORMAT INTL.

// BEGIN PLURALRULES INTL: complete original workload checks.
{
  const name = "jetstream-pluralrules-intl";
  if (modules.has(name)) {
    checked.add(name);
    const intlPluralRules = await import("./cases/jetstream-pluralrules-intl/case.ts");


    test("jetstream-pluralrules-intl retains the complete original Intl workload", () => {
        assert.equal(intlPluralRules.seed, 1);
        assert.equal(intlPluralRules.originalIterations, 2);
        assert.equal(intlPluralRules.defaultEnabled, false);
        assert.equal(intlPluralRules.work(0), 0);
        const snapshot = intlPluralRules.render(1);
        assert.equal(snapshot.iterations.length, 1);
        assert.equal(snapshot.expectedMinLength, 244000);
        assert.ok(snapshot.totalLength >= snapshot.expectedMinLength);
        const counts: Record<string, number> = {};
        for (const output of snapshot.iterations[0].outputs)
            counts[output.kind] = (counts[output.kind] ?? 0) + 1;
        assert.deepEqual(counts, {
        "options": 50,
        "select": 50000
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
        assert.equal(intlPluralRules.work(1), fold(0));
        assert.equal(intlPluralRules.work(2), fold(fold(0)));
        assert.equal(intlPluralRules.work(0), 0);
        assert.equal(intlPluralRules.work(1), fold(0));
        // Exact oracle text is tied to the recorded Intl data and timezone;
        // all-host original thresholds, full call counts and repeatability above
        // remain checked when running this test on a different host environment.
        if (process.version === "v24.20.0" && process.versions.icu === "78.3" &&
            Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC") {
            assert.equal(snapshot.totalLength, 244941);
            assert.equal(fold(0), 2873201836);
            assert.equal(createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
                "690d6389fafd648500de880851886242e59df28530e5d708f70a45d14f69bb94");
        }
    });
  }
}
// END PLURALRULES INTL.

// BEGIN RAYTRACE PUBLIC CLASS FIELDS: complete original workload checks.
{
  const name = "jetstream-raytrace-public-class-fields";
  if (modules.has(name)) {
    checked.add(name);
    const ray = await import("./cases/jetstream-raytrace-public-class-fields/case.ts");

    assert.equal(ray.seed, 1);
    assert.equal(ray.work(0), 0);
    assert.equal(ray.work(1), 301702705);
    assert.deepEqual(ray.observation(), {checkNumber: 2321, renders: 15, checksum: 301702705});
    assert.equal(ray.work(2), 2658908128);
    assert.deepEqual(ray.observation(), {checkNumber: 2321, renders: 30, checksum: 2658908128});
    assert.equal(ray.render(1), 2321);
    assert.equal(ray.work(1), 301702705);
    assert.equal(new ray.Ray(null, null).toString(), 'Ray [null,null]');
    const empty = new ray.IntersectionInfo();
    assert.equal(empty.position, null);
    assert.equal(empty.normal, null);
    assert.equal(empty.shape, null);
    assert.equal(empty.distance, null);
    const sphere = new ray.Sphere(new ray.Vector(0, 0, 0), new ray.SolidMaterial(new ray.Color(0.25, 0.5, 0.75), 0.3, 0, 2), 1);
    const hit = sphere.intersect(new ray.Ray(new ray.Vector(0, 0, -3), new ray.Vector(0, 0, 1)));
    assert.equal(hit.isHit, true);
    assert.equal(hit.distance, 2);
    assert.equal(String(hit.position), 'Vector [0,0,-1]');
    assert.equal(String(hit.color), 'rgb(63,127,191)');
  }
}
// END RAYTRACE PUBLIC CLASS FIELDS.

// BEGIN RAYTRACE PRIVATE CLASS FIELDS: complete original workload checks.
{
  const name = "jetstream-raytrace-private-class-fields";
  if (modules.has(name)) {
    checked.add(name);
    const ray = await import("./cases/jetstream-raytrace-private-class-fields/case.ts");

    assert.equal(ray.seed, 1);
    assert.equal(ray.work(0), 0);
    assert.equal(ray.work(1), 301702705);
    assert.deepEqual(ray.observation(), {checkNumber: 2321, renders: 15, checksum: 301702705});
    assert.equal(ray.work(2), 2658908128);
    assert.deepEqual(ray.observation(), {checkNumber: 2321, renders: 30, checksum: 2658908128});
    assert.equal(ray.render(1), 2321);
    assert.equal(ray.work(1), 301702705);
    assert.equal(new ray.Ray(null, null).toString(), 'Ray [null,null]');
    const empty = new ray.IntersectionInfo();
    assert.equal(empty.position, null);
    assert.equal(empty.normal, null);
    assert.equal(empty.shape, null);
    assert.equal(empty.distance, null);
    const sphere = new ray.Sphere(new ray.Vector(0, 0, 0), new ray.SolidMaterial(new ray.Color(0.25, 0.5, 0.75), 0.3, 0, 2), 1);
    const hit = sphere.intersect(new ray.Ray(new ray.Vector(0, 0, -3), new ray.Vector(0, 0, 1)));
    assert.equal(hit.isHit, true);
    assert.equal(hit.distance, 2);
    assert.equal(String(hit.position), 'Vector [0,0,-1]');
    assert.equal(String(hit.color), 'rgb(63,127,191)');
  }
}
// END RAYTRACE PRIVATE CLASS FIELDS.

// BEGIN AI ASTAR: complete original workload checks.
{
  const name = "jetstream-ai-astar";
  if (modules.has(name)) {
    checked.add(name);
    // Independent original oracles; root retains absent-directory gating/import policy.
    const { seed, runIteration, work } = await import("./cases/jetstream-ai-astar/case.ts");
    const { createGrid } = await import("./cases/jetstream-ai-astar/data.ts");

    test("JetStream A* retains the full original 500 by 500 grid", () => {
      const grid = createGrid();
      assert.equal(seed, 1);
      assert.equal(grid.length, 500);
      assert.ok(grid.every(row => row.length === 500));
      assert.equal(createHash("sha256").update(JSON.stringify(grid)).digest("hex"), "9e12a9d5b72e2561fb185c590cc81ad61cd18c59699a7fc1651b7cbb405a20ab");
    });

    test("JetStream A* returns the complete original path", () => {
      const path = runIteration().map(node => [node.x, node.y]);
      assert.equal(path.length, 446);
      assert.deepEqual(path.at(-1), [123, 321]);
      assert.equal(createHash("sha256").update(JSON.stringify(path)).digest("hex"), "d216285ce66675288825a03fe8680ca47f95bf2ab6078e6f301c98abd9d890c8");
    });

    test("JetStream A* retains graph reuse and stable repeated output", () => {
      assert.equal(work(0), 0);
      assert.equal(work(1), 4060484377);
      assert.equal(work(2), 3967396530);
      assert.equal(work(1), 4060484377);
    });
  }
}
// END AI ASTAR.

// BEGIN GAUSSIAN BLUR: complete original workload checks.
{
  const name = "jetstream-gaussian-blur";
  if (modules.has(name)) {
    checked.add(name);
    // Independent original full-buffer oracles; root retains absent-directory gating.
    const { seed, runIterations, work } = await import("./cases/jetstream-gaussian-blur/case.ts");

    function gaussianWordBytes(words: Uint32Array): Buffer {
      const bytes = Buffer.alloc(words.length * 4);
      for (let i = 0; i < words.length; i++) bytes.writeUInt32LE(words[i], 4 * i);
      return bytes;
    }

    test("JetStream Gaussian blur retains full original in-place image evolution", () => {
      assert.equal(seed, 1);
      const fixtures = [
      {
        "n": 0,
        "sha256": "ddd914c9d93816e89eec9be4ec10b79890f1d7ecaa09f94b536a5ba18f5ae05c"
      },
      {
        "n": 1,
        "sha256": "5d7ee083c7632f3e47c0c2fba01f9a8bb78742dec9680d151822e9dea78580ef"
      },
      {
        "n": 2,
        "sha256": "1888a0c734dfc3ba3b8043978de088ef77eca60433686ad2ed38bee5711a4f86"
      }
    ];
      for (const fixture of fixtures) {
        const words = runIterations(fixture.n);
        assert.equal(words.length, 800 * 450);
        assert.equal(createHash("sha256").update(gaussianWordBytes(words)).digest("hex"), fixture.sha256);
      }
    });

    test("JetStream Gaussian blur uses deterministic independent trials", () => {
      assert.equal(work(0), 0);
      assert.equal(work(1), 467848763);
      assert.equal(work(2), 1882197264);
      assert.equal(work(1), 467848763);
    });
  }
}
// END GAUSSIAN BLUR.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});




// BEGIN DATETIMEFORMAT INTL: complete original workload checks.
{
  const name = "jetstream-datetimeformat-intl";
  if (modules.has(name)) {
    checked.add(name);
    const intlDateTimeFormat = await import("./cases/jetstream-datetimeformat-intl/case.ts");


    test("jetstream-datetimeformat-intl retains the complete original Intl workload", () => {
        assert.equal(intlDateTimeFormat.seed, 1);
        assert.equal(intlDateTimeFormat.originalIterations, 2);
        assert.equal(intlDateTimeFormat.defaultEnabled, false);
        assert.equal(intlDateTimeFormat.work(0), 0);
        const snapshot = intlDateTimeFormat.render(1);
        assert.equal(snapshot.iterations.length, 1);
        assert.equal(snapshot.expectedMinLength, 438000);
        assert.ok(snapshot.totalLength >= snapshot.expectedMinLength);
        const counts: Record<string, number> = {};
        for (const output of snapshot.iterations[0].outputs)
            counts[output.kind] = (counts[output.kind] ?? 0) + 1;
        assert.deepEqual(counts, {
        "options": 400,
        "format": 6800,
        "parts": 6800,
        "range": 392
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
        assert.equal(intlDateTimeFormat.work(1), fold(0));
        assert.equal(intlDateTimeFormat.work(2), fold(fold(0)));
        assert.equal(intlDateTimeFormat.work(0), 0);
        assert.equal(intlDateTimeFormat.work(1), fold(0));
        // Exact oracle text is tied to the recorded Intl data and timezone;
        // all-host original thresholds, full call counts and repeatability above
        // remain checked when running this test on a different host environment.
        if (process.version === "v24.20.0" && process.versions.icu === "78.3" &&
            Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC") {
            assert.equal(snapshot.totalLength, 445369);
            assert.equal(fold(0), 4088381521);
            assert.equal(createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
                "c514b5c31c937418216b6b261b647524732c4bf2cec365faf0bc4a4195710283");
        }
    });
  }
}
// END DATETIMEFORMAT INTL.






