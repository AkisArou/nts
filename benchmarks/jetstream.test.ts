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

// BEGIN BABYLON WTB: ten complete original programs and all bundled plugins.
{
  const name = "jetstream-babylon-wtb";
  const module = modules.get(name);
  interface BabylonValidation { name: string; input: string; ast: unknown; }
  interface BabylonCase extends RenderCase {
    validationResults(): BabylonValidation[];
    parseValidation(input: string, plugins: string[]): unknown;
  }
  function isBabylonCase(value: unknown): value is BabylonCase {
    return isRenderCase(value) && "validationResults" in value && typeof value.validationResults === "function" && "parseValidation" in value && typeof value.parseValidation === "function";
  }
  if (module !== undefined) {
    assert.ok(isBabylonCase(module));
    checked.add(name);
    test(`${name}: opaque count repeats every original parse`, () => {
      assert.equal(module.seed, 1);
      assert.deepEqual(module.render(0), []);
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 3366597289);
      assert.equal(module.work(2), 985130514);
      assert.deepEqual(module.render(1), module.render(2));
    });
    test(`${name}: every input byte and full AST matches untouched upstream`, () => {
      const expected = [
  {
    "name": "jquery-3.7.1.js",
    "inputBytes": 285314,
    "inputCharacters": 285314,
    "inputSHA256": "78a85aca2f0b110c29e0d2b137e09f0a1fb7a8e554b499f740d6744dc8962cfe",
    "astJSONCharacters": 6248361,
    "astJSONSHA256": "99f89c2d33981a4d2ae6f2b50904ceee8cc6f2f44a6effa94d704306f73f19ca",
    "end": 285314
  },
  {
    "name": "lodash.core-4.17.21.js",
    "inputBytes": 115957,
    "inputCharacters": 115957,
    "inputSHA256": "e7ace8c713f76cf458b9f90fb4735f52225cc8c69a0e7b319bd9b78764307add",
    "astJSONCharacters": 1206646,
    "astJSONSHA256": "5bd16c65492efa001db0de6fb1e524a06565a8eed2552cd319f936975e15b190",
    "end": 115957
  },
  {
    "name": "preact-8.2.5.js",
    "inputBytes": 20772,
    "inputCharacters": 20772,
    "inputSHA256": "e5b962b9e5d1ee004d580358fa2e3432599b46fbb413a6d67f02709eb4c72922",
    "astJSONCharacters": 528136,
    "astJSONSHA256": "a75c4aef307803437def9e0f29e627a00a6eee1f07e43b522eb5be29e3ac62fc",
    "end": 20772
  },
  {
    "name": "redux-5.0.1.min.js",
    "inputBytes": 10326,
    "inputCharacters": 10326,
    "inputSHA256": "ede13715143b60e3d24d15b3bc9477ea9e606c8d6fe32d423e01dd7e9b056568",
    "astJSONCharacters": 283772,
    "astJSONSHA256": "17545b43d9dca020b6a8cfbfe9502c8c0083eb7855d24ca744376519aa9a2c5e",
    "end": 10326
  },
  {
    "name": "speedometer-es2015-test-2.0.js",
    "inputBytes": 24849,
    "inputCharacters": 24849,
    "inputSHA256": "aa04b51702a63e970f6fbb33c22cca82e2b03ed304c625b246dba30b12f73ae8",
    "astJSONCharacters": 477552,
    "astJSONSHA256": "38dac21a50122610ffb687ab2cf1c2ea71c32d6542c53c02362335857e25e320",
    "end": 24849
  },
  {
    "name": "todomvc/react/app.jsx",
    "inputBytes": 5457,
    "inputCharacters": 5457,
    "inputSHA256": "d13dc0d779d440f20da65b09b17da0a42ec37c5aba5f7081145fd7ed250e1030",
    "astJSONCharacters": 107846,
    "astJSONSHA256": "eefdf5682b2e7e66db5fa2977fe7ab4f50fcfdd817a86e311af662a264b1632b",
    "end": 5457
  },
  {
    "name": "todomvc/react/footer.jsx",
    "inputBytes": 1338,
    "inputCharacters": 1338,
    "inputSHA256": "906ce71602a45bdf4489db790721a576cae27bbc8a3cca07f163eb4343994d37",
    "astJSONCharacters": 36931,
    "astJSONSHA256": "6d17c6ae0c1d797e0f2dad8a6ed946013b979ff243b63b1dead5cf471916c44a",
    "end": 1338
  },
  {
    "name": "todomvc/react/todoItem.jsx",
    "inputBytes": 2926,
    "inputCharacters": 2926,
    "inputSHA256": "8e9990d2595d906eb30729d91b13cfd3f07b372c2bb507b7354919cacc6e4149",
    "astJSONCharacters": 67560,
    "astJSONSHA256": "a08180f8c309f1d246d32ffd04c8b3f2a2c7523df6780a21bcbc0739d9da9bd6",
    "end": 2926
  },
  {
    "name": "underscore-1.13.7.js",
    "inputBytes": 68778,
    "inputCharacters": 68766,
    "inputSHA256": "24f3a110916c46a4d7fb762a7b8994a6c2daad7efd62604b1ba2a9e8c2bf4e03",
    "astJSONCharacters": 1441726,
    "astJSONSHA256": "39f201e2730f64fc986e7eef778607495cd02ca87c811855fff14d9904498098",
    "end": 68766
  },
  {
    "name": "vue-3.5.18.runtime.esm-browser.js",
    "inputBytes": 368334,
    "inputCharacters": 368334,
    "inputSHA256": "7d5c8dc7db5433647c5ddf89e1652e79653c2ab1217963b7746f28aafe0daf25",
    "astJSONCharacters": 8614672,
    "astJSONSHA256": "63f62f85c1114a4c69b7ae8ac1935abf5a40813e0c9b1f5bff76f9357ebdd418",
    "end": 368334
  }
];
      const actual = module.validationResults();
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < expected.length; i++) {
        const got = actual[i], want = expected[i];
        assert.equal(got.name, want.name);
        assert.equal(got.input.length, want.inputCharacters);
        assert.equal(sha256(got.input), want.inputSHA256);
        const serialized = JSON.stringify(got.ast);
        assert.equal(serialized.length, want.astJSONCharacters);
        assert.equal(sha256(serialized), want.astJSONSHA256);
      }
    });
    test(`${name}: retained Flow, TypeScript, JSX and ESTree grammar fixtures match upstream`, () => {
      const fixtures = [
  {
    "source": "type X = {a: number}; const a: X = {a:1};",
    "options": {
      "plugins": [
        "flow"
      ]
    },
    "astJSONSHA256": "50b4129b9f49627196fd58d57c1b181a9fc6ce1c22890e6378bbd88e816fa3cd"
  },
  {
    "source": "interface X {a: number}; const a: X = {a:1};",
    "options": {
      "plugins": [
        "typescript"
      ]
    },
    "astJSONSHA256": "2ac2d9431fb45e70f47c389a3d548bcca5bbf005b52ad25687c39d6089ec9d1d"
  },
  {
    "source": "const x = <p>hello</p>;",
    "options": {
      "plugins": [
        "jsx"
      ]
    },
    "astJSONSHA256": "1f56bd122fe56c5baaf861c79ae9c62818f8d394029315a07104cd2824aaca82"
  },
  {
    "source": "const x = /a+/g; function f(a=1) {return a**2;}",
    "options": {
      "plugins": [
        "estree"
      ]
    },
    "astJSONSHA256": "88b955facb7bc63b16470e6d6f6bf52109ca23663757c493c41fec92c53d6fc6"
  }
];
      for (const fixture of fixtures) {
        assert.equal(sha256(JSON.stringify(module.parseValidation(fixture.source, fixture.options.plugins))), fixture.astJSONSHA256);
      }
    });
  }
}
// END BABYLON WTB.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
