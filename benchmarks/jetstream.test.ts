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

// BEGIN ESPREE WTB: complete original inputs, tokens and ASTs.
{
  const name = "jetstream-espree-wtb";
  const module = modules.get(name);
  interface EspreeValidation { name: string; input: string; ast: unknown; tokens: unknown[]; }
  interface EspreeCase extends RenderCase { validationResults(): EspreeValidation[]; parseValidation(input: string): unknown; }
  function isEspreeCase(value: unknown): value is EspreeCase {
    return isRenderCase(value) && "validationResults" in value && typeof value.validationResults === "function" && "parseValidation" in value && typeof value.parseValidation === "function";
  }
  if (module !== undefined) {
    assert.ok(isEspreeCase(module));
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
    "astJSONSHA256": "1499ed2db99747a9480c674cf03b1b5eef40d32c4bd84f1c258ca7beeacb6f7f",
    "tokensJSONSHA256": "2abbd1b44ec1a07cebb0a7297b73accf15e23ad9a8ebe448c4c4fb2d3362d02b",
    "tokens": 11316,
    "tokenAndTopLevelStatementCount": 11317
  },
  {
    "name": "jquery-3.7.1.js",
    "inputBytes": 285314,
    "inputCharacters": 285314,
    "inputSHA256": "78a85aca2f0b110c29e0d2b137e09f0a1fb7a8e554b499f740d6744dc8962cfe",
    "astJSONSHA256": "cd08ad8bd7c8122a656ddbcd3def388080eaa300133f6b2166eb2f2fa576dcd8",
    "tokensJSONSHA256": "641d7ad7fd4501f146ca6fee8aa83273889dfc59fca05d5d3c1fe733e9e94411",
    "tokens": 44605,
    "tokenAndTopLevelStatementCount": 44606
  },
  {
    "name": "mootools-core-1.6.0.js",
    "inputBytes": 162032,
    "inputCharacters": 162032,
    "inputSHA256": "176024679735c15d3fb08fc093237149adc39e86766db0dc597c31d44fd0a5ac",
    "astJSONSHA256": "1062276e2a1af8bdd1ba15a347142219e9c4067367774548952d41bef097d2fa",
    "tokensJSONSHA256": "292fee2e79681cfe77acfa8ce9bad324ade703c314fe15edc2fe341b0f29095f",
    "tokens": 38365,
    "tokenAndTopLevelStatementCount": 38429
  },
  {
    "name": "underscore-1.13.7.js",
    "inputBytes": 68778,
    "inputCharacters": 68766,
    "inputSHA256": "24f3a110916c46a4d7fb762a7b8994a6c2daad7efd62604b1ba2a9e8c2bf4e03",
    "astJSONSHA256": "0074f7c6b7f8514766fb2c30393110792abece24f0e2ec2c995eb7b8214a6da3",
    "tokensJSONSHA256": "afe43025d9752ce4e22cb7fa900994f4299ae9a1f41d1d86588c5093e440af0c",
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
  "astJSONSHA256": "a172bc94aac08a5201c0cc9b17db3480c40db0fc62f1cf8f24612090cff076cf"
};
      assert.equal(sha256(JSON.stringify(module.parseValidation(fixture.source))), fixture.astJSONSHA256);
    });
  }
}
// END ESPREE WTB.

test("every installed JetStream case has program-specific correctness checks", () => {
  assert.deepEqual(names.filter(name => !checked.has(name)), []);
});
