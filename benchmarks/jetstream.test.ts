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

// BEGIN ACORN WTB: complete original inputs, tokenization and AST walk.
{
  const name = "jetstream-acorn-wtb";
  const module = modules.get(name);
  interface AcornValidation { name: string; input: string; ast: unknown; tokens: unknown[]; }
  interface AcornCase extends RenderCase { validationResults(): AcornValidation[]; }
  function isAcornCase(value: unknown): value is AcornCase {
    return isRenderCase(value) && "validationResults" in value && typeof value.validationResults === "function";
  }
  if (module !== undefined) {
    assert.ok(isAcornCase(module));
    checked.add(name);
    test(`${name}: all eight original token and walker counts`, () => {
      assert.deepEqual(module.render(1), [18479, 73648, 12608, 7354, 3880, 5760, 17842, 117058]);
      assert.deepEqual(module.render(2), [18479, 73648, 12608, 7354, 3880, 5760, 17842, 117058]);
      assert.deepEqual(module.render(0), []);
      assert.equal(module.seed, 1);
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 2288699203);
      assert.equal(module.work(2), 117939078);
    });
    test(`${name}: every input byte, token and AST node matches untouched upstream`, () => {
      const expected = [
  {
    "name": "backbone-1.6.1.js",
    "inputBytes": 80436,
    "inputCharacters": 80436,
    "inputSHA256": "843bd01aa3944ef9e3f426f35cf6fa46f4a55985bf9af23a2d01b3d447ed4121",
    "astJSONSHA256": "57a5664dcf1a8602f73affc326916868141e9d557bc57946ac28ec81ef35448f",
    "tokensJSONSHA256": "aa4c6daf5c48abc6cbf84c06ade396a60b292dee3c409ba564c3197022cc6191",
    "tokens": 11316,
    "tokenAndWalkerCount": 18479
  },
  {
    "name": "jquery-3.7.1.js",
    "inputBytes": 285314,
    "inputCharacters": 285314,
    "inputSHA256": "78a85aca2f0b110c29e0d2b137e09f0a1fb7a8e554b499f740d6744dc8962cfe",
    "astJSONSHA256": "086666a2b63fbd056d1f5392eec73a5c7f250800225ced24bf9052399b1f3c5e",
    "tokensJSONSHA256": "cdb5dedb95c111ea74c3ceb363c7e98cf6a24a2844ced49a8cc283ebb44a626f",
    "tokens": 44605,
    "tokenAndWalkerCount": 73648
  },
  {
    "name": "lodash.core-4.17.21.js",
    "inputBytes": 115957,
    "inputCharacters": 115957,
    "inputSHA256": "e7ace8c713f76cf458b9f90fb4735f52225cc8c69a0e7b319bd9b78764307add",
    "astJSONSHA256": "987f91774d54e6d2c8d938f4dcaf487cef9d42789eb5d680f4a19c1cd2495992",
    "tokensJSONSHA256": "a64e86a44ee0fe96619512ecd0de947197584b5f5d2ac5d067608d5c494cc75a",
    "tokens": 7507,
    "tokenAndWalkerCount": 12608
  },
  {
    "name": "preact-8.2.5.js",
    "inputBytes": 20772,
    "inputCharacters": 20772,
    "inputSHA256": "e5b962b9e5d1ee004d580358fa2e3432599b46fbb413a6d67f02709eb4c72922",
    "astJSONSHA256": "362987988fbd679b606c4f8a89a5ff638daba0dbc8a84c7ed034bffee0338305",
    "tokensJSONSHA256": "78bd8576d62c10f167e263992d823d3dfc2bdae11db1a38713ce6ac446d669c2",
    "tokens": 4358,
    "tokenAndWalkerCount": 7354
  },
  {
    "name": "redux-5.0.1.min.js",
    "inputBytes": 10326,
    "inputCharacters": 10326,
    "inputSHA256": "ede13715143b60e3d24d15b3bc9477ea9e606c8d6fe32d423e01dd7e9b056568",
    "astJSONSHA256": "ab04ef9e8b5ac3eb0a0679f30705064ab1d841ab4c7a94d56621a80707283f66",
    "tokensJSONSHA256": "d2c1cc1002cf7d64ee4c92f0ad2015f6a65f01dbb1e93aacb72737f1a65e3b5b",
    "tokens": 2318,
    "tokenAndWalkerCount": 3880
  },
  {
    "name": "speedometer-es2015-test-2.0.js",
    "inputBytes": 24849,
    "inputCharacters": 24849,
    "inputSHA256": "aa04b51702a63e970f6fbb33c22cca82e2b03ed304c625b246dba30b12f73ae8",
    "astJSONSHA256": "bae86a4f13fa1b1d3efb167621b6a1dfdaaecd3b2edf96571e868cdf532492fd",
    "tokensJSONSHA256": "afad3231284d3dec5047427318d60fbbc54fc2519639d246b5eaec819a323665",
    "tokens": 3485,
    "tokenAndWalkerCount": 5760
  },
  {
    "name": "underscore-1.13.7.js",
    "inputBytes": 68778,
    "inputCharacters": 68766,
    "inputSHA256": "24f3a110916c46a4d7fb762a7b8994a6c2daad7efd62604b1ba2a9e8c2bf4e03",
    "astJSONSHA256": "ae826610237b10940836ebed9a4a9bf2ab4e2b66684df11f73801c8e1e80f3de",
    "tokensJSONSHA256": "f252cdffcbcdbde4ab26ca11fe9a0c067e247bed4ff8d1cb4d2733d2ba5f8ee6",
    "tokens": 10686,
    "tokenAndWalkerCount": 17842
  },
  {
    "name": "vue-3.5.18.runtime.esm-browser.js",
    "inputBytes": 368334,
    "inputCharacters": 368334,
    "inputSHA256": "7d5c8dc7db5433647c5ddf89e1652e79653c2ab1217963b7746f28aafe0daf25",
    "astJSONSHA256": "58806f010c46e4b59756e17b18dfdc28de385079d1835dd1907fdc556765db6a",
    "tokensJSONSHA256": "b67a8344e5ed9baee3d9b2edf677f1e956e0899c6d8a638e15e4dd7f416c2897",
    "tokens": 71110,
    "tokenAndWalkerCount": 117058
  }
];
      const actual = module.validationResults();
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < expected.length; i++) {
        const got = actual[i], want = expected[i];
        assert.equal(got.name, want.name);
        assert.equal(got.input.length, want.inputCharacters);
        assert.equal(sha256(got.input), want.inputSHA256);
        assert.equal(got.tokens.length, want.tokens);
        assert.equal(sha256(JSON.stringify(got.tokens)), want.tokensJSONSHA256);
        assert.equal(sha256(JSON.stringify(got.ast)), want.astJSONSHA256);
      }
    });
  }
}
// END ACORN WTB.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
