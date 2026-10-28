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

// BEGIN ESPRIMA NEXT WTB: complete original inputs, tokens and ASTs.
{
  const name = "jetstream-esprima-next-wtb";
  const module = modules.get(name);
  interface EsprimaValidation { name: string; input: string; ast: unknown; tokens: unknown[]; }
  interface EsprimaCase extends RenderCase { validationResults(): EsprimaValidation[]; parseValidation(input: string): unknown; visitorValidation(): boolean[]; }
  function isEsprimaCase(value: unknown): value is EsprimaCase {
    return isRenderCase(value) && "validationResults" in value && typeof value.validationResults === "function" && "parseValidation" in value && typeof value.parseValidation === "function" && "visitorValidation" in value && typeof value.visitorValidation === "function";
  }
  if (module !== undefined) {
    assert.ok(isEsprimaCase(module));
    checked.add(name);
    test(`${name}: all four original tokenizer/parser counts`, () => {
      assert.deepEqual(module.render(1), [11317, 44606, 38429, 10687]);
      assert.deepEqual(module.render(2), [11317, 44606, 38429, 10687]);
      assert.deepEqual(module.render(0), []);
      assert.equal(module.seed, 1);
      assert.equal(module.work(0), 0);
      assert.equal(module.work(1), 381213099);
      assert.equal(module.work(2), 214361558);
    });
    test(`${name}: every input byte, token and AST node matches untouched upstream`, () => {
      const expected = [
  {
    "name": "backbone-1.6.1.js",
    "inputBytes": 80436,
    "inputCharacters": 80436,
    "inputSHA256": "843bd01aa3944ef9e3f426f35cf6fa46f4a55985bf9af23a2d01b3d447ed4121",
    "astJSONSHA256": "bb6fd0e25637fdce31caa58f157aede93714ff83c7ce66c302ce0aaa052c8c8d",
    "tokensJSONSHA256": "64377c7b6652b1861666969f9ac7fe9c1ff5843fbbb0e381128ea840dec74b92",
    "tokens": 11316,
    "tokenAndTopLevelStatementCount": 11317
  },
  {
    "name": "jquery-3.7.1.js",
    "inputBytes": 285314,
    "inputCharacters": 285314,
    "inputSHA256": "78a85aca2f0b110c29e0d2b137e09f0a1fb7a8e554b499f740d6744dc8962cfe",
    "astJSONSHA256": "b100544e256818dbc1e1d0b7741b697c8f1c89d267d547af464fe7b4055b30d1",
    "tokensJSONSHA256": "42aac4974f694a9e0c903e1cf6e5aac381083bc08b4a9ea381d88691dfc83d6f",
    "tokens": 44605,
    "tokenAndTopLevelStatementCount": 44606
  },
  {
    "name": "mootools-core-1.6.0.js",
    "inputBytes": 162032,
    "inputCharacters": 162032,
    "inputSHA256": "176024679735c15d3fb08fc093237149adc39e86766db0dc597c31d44fd0a5ac",
    "astJSONSHA256": "ca877a4ec1decaaf3fba535f40d0d75c52d3cc6ee4efc2523fe2b931ff1d6b3e",
    "tokensJSONSHA256": "8ae401ff0102b59bcacddba122cd0a918b8c6904f92399ec1a057dad5c64c1cb",
    "tokens": 38365,
    "tokenAndTopLevelStatementCount": 38429
  },
  {
    "name": "underscore-1.13.7.js",
    "inputBytes": 68778,
    "inputCharacters": 68766,
    "inputSHA256": "24f3a110916c46a4d7fb762a7b8994a6c2daad7efd62604b1ba2a9e8c2bf4e03",
    "astJSONSHA256": "55fc5b9f5ac213ca2aa8686ea5f72f02fcf1c95962b346c63974a2b316947f68",
    "tokensJSONSHA256": "8c6a5f49258e14b3467636e23c76d1c0d5ede983ff1399400c5666cf3fbaa5f6",
    "tokens": 10686,
    "tokenAndTopLevelStatementCount": 10687
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
    test(`${name}: retained JSX, template, regexp and comment paths match upstream`, () => {
      const fixture = {
  "source": "// complete JSX, template and regexp paths\nconst x = <section attr=\"hello\">{`world${1+2}`}&amp;</section>; const r = /a+/g;",
  "astJSONSHA256": "0e411bd7883e56cb92098b147d625422f80d323a0da8b338a8e7e80075bf023f"
};
      assert.equal(sha256(JSON.stringify(module.parseValidation(fixture.source))), fixture.astJSONSHA256);
    });
    test(`${name}: retained modern grammar paths match untouched upstream`, () => {
      const fixtures = [
  {
    "source": "const {a,b:c=1,...rest}=obj; const f=(x,{y},...z)=>x+y; async function q(a=1){return await Promise.resolve(a)}",
    "astJSONSHA256": "cb44f986d15eb92a295f755087f1bb6a8bc83022741d8de784aeb0b4b7d4a485"
  },
  {
    "source": "class C extends B { #x=1; static {this.v=2;} m(a){return this.#x+a;} }",
    "astJSONSHA256": "bac7ec1095ce32837838e6f8145be4b46842373a4e42c1f2396666a2af2543fd"
  },
  {
    "source": "const n=123n; const x=a?.b?.(1) ?? 2;",
    "astJSONSHA256": "ef9fc84cd20b809f0389a53586bd271be9c3934f2615807be0140d841a4f70b0"
  }
];
      for (const fixture of fixtures) {
        const serialized = JSON.stringify(module.parseValidation(fixture.source), (key: string, value: unknown) => typeof value === "bigint" ? {$bigint: value.toString()} : value);
        assert.equal(sha256(serialized), fixture.astJSONSHA256);
      }
      assert.deepEqual(module.visitorValidation(), [true, true, true, true]);
    });
  }
}
// END ESPRIMA NEXT WTB.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
