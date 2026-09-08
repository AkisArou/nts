import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseJsonText } from "../src/json/parse.ts";
import { parsePlainText, toPlainValue } from "../src/json/plain.ts";
import { INVALID, VALID } from "./json-corpus.ts";

// `parsePlainText` is a second route through the same grammar: it builds ordinary objects
// directly where `toPlainValue(parseJsonText(t))` builds the erased graph and walks it. Two
// routes is two places for a specification bug, and the only thing that makes it safe is
// holding them against each other -- and against node -- on every case there is.
//
// So this file asserts equivalence rather than behaviour. A case that belongs to JSON itself
// goes in `json-corpus.ts` with the others; what is here is the claim that the fast route
// cannot disagree with the canonical one.

/** The canonical route, spelled once. */
function canonical(text: string): unknown {
  return toPlainValue(parseJsonText(text));
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "<no error>";
}

describe("parsePlainText agrees with the canonical route", () => {
  it("produces the same value as the graph route for every valid case", () => {
    for (const text of VALID) {
      assert.deepStrictEqual(
        parsePlainText(text),
        canonical(text),
        `one-pass and graph routes disagree on ${text}`,
      );
    }
  });

  it("produces the same value as node for every valid case", () => {
    for (const text of VALID) {
      assert.deepStrictEqual(
        parsePlainText(text),
        JSON.parse(text),
        `one-pass route disagrees with node on ${text}`,
      );
    }
  });

  it("orders keys identically to the graph route, index keys included", () => {
    for (const text of VALID) {
      const fast = parsePlainText(text);
      if (typeof fast !== "object" || fast === null || Array.isArray(fast)) continue;
      assert.deepStrictEqual(
        Object.keys(fast),
        Object.keys(canonical(text) as object),
        `key order differs on ${text}`,
      );
    }
  });

  it("fails with the identical message on every invalid case", () => {
    for (const text of INVALID) {
      const fast = messageOf(() => parsePlainText(text));
      const slow = messageOf(() => canonical(text));
      assert.notStrictEqual(fast, "<no error>", `accepted invalid text ${text}`);
      assert.strictEqual(fast, slow, `error text differs on ${text}`);
    }
  });
});

describe("the cases where building directly could differ", () => {
  it("keeps __proto__ as an own data property rather than setting the prototype", () => {
    const parsed = parsePlainText('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    assert.strictEqual(Object.getPrototypeOf(parsed), Object.prototype);
    assert.ok(Object.hasOwn(parsed, "__proto__"));
    assert.deepStrictEqual(parsed["__proto__"], { polluted: true });
    assert.strictEqual(({} as Record<string, unknown>)["polluted"], undefined);
    assert.deepStrictEqual(parsed, canonical('{"__proto__":{"polluted":true}}'));
  });

  it("gives a repeated key its first position and its last value", () => {
    const text = '{"b":1,"a":2,"b":3}';
    const parsed = parsePlainText(text) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(parsed), ["b", "a"]);
    assert.strictEqual(parsed["b"], 3);
    assert.deepStrictEqual(parsed, canonical(text));
    assert.deepStrictEqual(parsed, JSON.parse(text));
  });

  it("puts array-index keys first in numeric order, as OrdinaryOwnPropertyKeys requires", () => {
    const text = '{"10":"a","x":"b","9":"c","2":"d"}';
    const parsed = parsePlainText(text) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(parsed), ["2", "9", "10", "x"]);
    assert.deepStrictEqual(parsed, canonical(text));
    assert.deepStrictEqual(Object.keys(parsed), Object.keys(JSON.parse(text) as object));
  });

  it("keeps a key that only looks like an index in insertion order", () => {
    const text = '{"01":"a","b":"c","-1":"d","1.5":"e","4294967295":"f"}';
    const parsed = parsePlainText(text) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(parsed), Object.keys(JSON.parse(text) as object));
    assert.deepStrictEqual(parsed, canonical(text));
  });

  it("gives an empty container the right identity and prototype", () => {
    assert.deepStrictEqual(parsePlainText("{}"), {});
    assert.deepStrictEqual(parsePlainText("[]"), []);
    assert.ok(Array.isArray(parsePlainText("[]")));
    assert.strictEqual(Object.getPrototypeOf(parsePlainText("{}")), Object.prototype);
  });

  it("nests deeply without recursing", () => {
    const depth = 20000;
    const text = "[".repeat(depth) + "]".repeat(depth);
    let node = parsePlainText(text) as unknown[];
    let seen = 1;
    while (node.length === 1) {
      node = node[0] as unknown[];
      seen++;
    }
    assert.strictEqual(seen, depth);
  });

  it("preserves lone surrogates exactly as the graph route does", () => {
    for (const text of ['"\\ud800"', '"\\udfff"', '"\\ud800\\ud800"', '"\\udbff\\udfff"']) {
      assert.strictEqual(parsePlainText(text), canonical(text));
      assert.strictEqual(parsePlainText(text), JSON.parse(text));
    }
  });
});

describe("randomised documents", () => {
  // A deterministic generator, so a failure is reproducible from the seed printed with it.
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  const ALPHABET: readonly string[] = [
    "a",
    "z",
    " ",
    '"',
    "\\",
    "\n",
    "\t",
    "é",
    "日",
    "\u{1f600}",
    "\ud800",
    "",
  ];

  const KEYS: readonly string[] = ["a", "b", "0", "1", "10", "__proto__", "x y", '"', "日"];

  function build(random: () => number, depth: number): unknown {
    const pick = random();
    if (depth > 4 || pick < 0.3) {
      const leaf = random();
      if (leaf < 0.15) return null;
      if (leaf < 0.3) return random() < 0.5;
      if (leaf < 0.65) return Math.floor(random() * 2000) - 1000;
      if (leaf < 0.8) return (random() * 1e6 - 5e5) / 7;
      let text = "";
      const length = Math.floor(random() * 6);
      for (let at = 0; at < length; at++) {
        text += ALPHABET[Math.floor(random() * ALPHABET.length)] as string;
      }
      return text;
    }
    const count = Math.floor(random() * 5);
    if (pick < 0.65) {
      const items: unknown[] = [];
      for (let at = 0; at < count; at++) items.push(build(random, depth + 1));
      return items;
    }
    const object: Record<string, unknown> = {};
    for (let at = 0; at < count; at++) {
      object[KEYS[Math.floor(random() * KEYS.length)] as string] = build(random, depth + 1);
    }
    return object;
  }

  it("agrees with the graph route and with node on 2000 generated documents", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const random = makeRandom(seed);
      const text = JSON.stringify(build(random, 0));
      assert.deepStrictEqual(parsePlainText(text), canonical(text), `seed ${seed}: ${text}`);
      assert.deepStrictEqual(parsePlainText(text), JSON.parse(text), `seed ${seed}: ${text}`);
    }
  });

  it("agrees on truncations of generated documents, which are mostly invalid", () => {
    let rejected = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const random = makeRandom(seed);
      const text = JSON.stringify(build(random, 0));
      for (let cut = 1; cut < text.length; cut++) {
        const piece = text.slice(0, cut);
        const fast = messageOf(() => parsePlainText(piece));
        const slow = messageOf(() => canonical(piece));
        assert.strictEqual(fast, slow, `seed ${seed} cut ${cut}: ${piece}`);
        if (fast !== "<no error>") rejected++;
      }
    }
    // A run where nothing was malformed would assert nothing and pass.
    assert.ok(rejected > 1000, `expected truncations to be rejected, got ${rejected}`);
  });
});
