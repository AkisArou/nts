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

// BEGIN BABYLON: add this complete section with the Babylon case.
interface BabylonOptions {
  sourceType?: string;
  plugins?: string[];
}

interface BabylonCase extends AresCase {
  parseSources(): unknown;
  sourceNames(): string[];
  parse(input: string, options?: BabylonOptions): unknown;
}

interface BabylonFile {
  type: string;
  start: number;
  end: number;
  program: { type: string; sourceType: string; body: unknown[] };
  tokens: unknown[];
  comments: unknown[];
}

function isBabylonCase(value: unknown): value is BabylonCase {
  return isAresCase(value) && "parseSources" in value && typeof value.parseSources === "function" &&
    "sourceNames" in value && typeof value.sourceNames === "function" &&
    "parse" in value && typeof value.parse === "function";
}

function isBabylonFile(value: unknown): value is BabylonFile {
  return isRecord(value) && typeof value.type === "string" && typeof value.start === "number" &&
    typeof value.end === "number" && isRecord(value.program) && typeof value.program.type === "string" &&
    typeof value.program.sourceType === "string" && Array.isArray(value.program.body) &&
    Array.isArray(value.tokens) && Array.isArray(value.comments);
}

{
  const name = "ares6-babylon";
  const benchmark = modules.get(name);
  if (benchmark !== undefined) {
    assert.ok(isBabylonCase(benchmark), `${name}: missing complete parser observations`);
    checked.add(name);

    test(`${name}: every original source produces its complete upstream AST`, () => {
      // Babylon/benchmark.js parses these four complete blobs, in this order.
      // Each hash covers JSON.stringify of the whole original AST, including
      // tokens, comments, locations, literals, grammar nodes and field order.
      assert.deepEqual(benchmark.sourceNames(), [
        "./Babylon/air-blob.js",
        "./Babylon/basic-blob.js",
        "./Babylon/inspector-blob.js",
        "./Babylon/babylon-blob.js",
      ]);
      const files = benchmark.parseSources();
      assert.ok(Array.isArray(files));
      const oracles = [
        { end: 4052, body: 2, tokens: 631, comments: 3, characters: 251073, type: "script", sha256: "91b17e573431e471288df034622032c0202413669620b751cd9977aac5a2ae38" },
        { end: 7803, body: 37, tokens: 1561, comments: 2, characters: 636161, type: "script", sha256: "2d308b2e577cf2794334fa6f320ac742d6b2356279c9446fc7a7a1882b472b6d" },
        { end: 49897, body: 3, tokens: 6921, comments: 31, characters: 2872993, type: "script", sha256: "578759f3de7d831ec159c97f792e81733c6ee01eea2d8c770d36acc82a40101c" },
        { end: 2912, body: 5, tokens: 380, comments: 4, characters: 154799, type: "module", sha256: "92658481a91b114f0f64efcd9ced551a0bb0a4e2dc31d7a9656f8f9f6acfe875" },
      ];
      assert.equal(files.length, oracles.length);
      for (let i = 0; i < oracles.length; i++) {
        const file: unknown = files[i];
        assert.ok(isBabylonFile(file), `source ${i}: malformed File AST`);
        const oracle = oracles[i];
        assert.equal(file.type, "File");
        assert.equal(file.start, 0);
        assert.equal(file.end, oracle.end);
        assert.equal(file.program.type, "Program");
        assert.equal(file.program.sourceType, oracle.type);
        assert.equal(file.program.body.length, oracle.body);
        assert.equal(file.tokens.length, oracle.tokens);
        assert.equal(file.comments.length, oracle.comments);
        const serialized = JSON.stringify(file);
        assert.equal(serialized.length, oracle.characters);
        assert.equal(sha256(serialized), oracle.sha256, `source ${i}: complete upstream AST`);
      }
    });

    test(`${name}: retained ESTree, Flow and JSX grammar produces upstream ASTs`, () => {
      const samples: { source: string; plugins: string[]; sha256: string }[] = [
        {
          source: '"use strict"; ({ get value() {return 1}, set value(x) {}, m(a) { return a; }, p: /x/g }); class C { method(x) {return x;} }',
          plugins: ["estree"],
          sha256: "35c2f3bf9a9b611a71b964c00c1657cec6c290f4c3af2ccf3b2ccfe83292fce6",
        },
        {
          source: "type A<T> = { +x: T, y?: string }; function id<T>(x: T): T { return x; } const f = (x: number): number => x + 1; interface I { value: number; }",
          plugins: ["flow"],
          sha256: "e968069b0f8489adf6d035ec797e0ad81cd6f31f8babfa0362c7563c672a9349",
        },
        {
          source: 'const x = <main title="a &amp; b">Hello {name}<Child {...props}/></main>;',
          plugins: ["jsx"],
          sha256: "7e41a4b42d86d3c6c5fe3c8405b6b893830999c68254030a50f6d4c400543816",
        },
      ];
      for (const sample of samples) {
        const ast = benchmark.parse(sample.source, { plugins: sample.plugins });
        assert.ok(isBabylonFile(ast));
        assert.equal(sha256(JSON.stringify(ast)), sample.sha256, sample.plugins.join("+"));
      }
    });

    test(`${name}: upstream syntax validation preserves error text and positions`, () => {
      const errors: { source: string; options: BabylonOptions; message: string; pos: number }[] = [
        { source: "let x = ;", options: {}, message: "Unexpected token (1:8)", pos: 8 },
        { source: "return 1;", options: {}, message: "'return' outside of function (1:0)", pos: 0 },
        { source: "let await = 1;", options: { sourceType: "module" }, message: "await is a reserved word (1:4)", pos: 4 },
        { source: "const x = <p></q>;", options: { plugins: ["jsx"] }, message: "Expected corresponding JSX closing tag for <p> (1:13)", pos: 13 },
        { source: '"use strict"; var eval = 1;', options: {}, message: "eval is a reserved word in strict mode (1:18)", pos: 18 },
      ];
      for (const oracle of errors) {
        assert.throws(() => benchmark.parse(oracle.source, oracle.options), (error: unknown) => {
          assert.ok(error instanceof SyntaxError);
          assert.equal(error.message, oracle.message);
          assert.ok("pos" in error);
          assert.equal(error.pos, oracle.pos);
          assert.ok("loc" in error && isRecord(error.loc));
          assert.equal(error.loc.line, 1);
          assert.equal(error.loc.column, oracle.pos);
          return true;
        });
      }
    });

    test(`${name}: each repetition parses all four complete inputs`, () => {
      assert.equal(benchmark.work(0), 0);
      assert.equal(benchmark.work(1), 928301361);
      assert.equal(benchmark.work(2), 1414335650);
      assert.equal(benchmark.work(3), 4007588435);
    });
  }
}
// END BABYLON.

test("every installed ARES-6 case has program-specific correctness checks", () => {
  assert.deepEqual(cases.filter((name) => !checked.has(name)), [], "installed rows without independent oracles");
});
