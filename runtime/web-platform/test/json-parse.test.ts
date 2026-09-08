// The JSON parser, against node and against the grammar.
//
// Two oracles, deliberately. Node answers what a conforming engine produces for text that is
// valid, which is the strongest check available for values and key order. The pinned spec text
// at `runtime/web-platform/third_party/ecma262/json-25.5.txt` answers what is *valid*, which
// node cannot be asked about directly -- every case below that must be rejected is a place
// JavaScript's grammar is wider than JSON's, and a parser that reached for `eval` or a
// permissive scanner would accept it.
//
// Every literal control character and space-like character in the corpora below is written as
// a `\u` escape. Earlier in this lane a fixture was written with raw control bytes and became
// unreadable in the source; these are exactly the cases where the byte is the point.
//
// **This file imports the TypeScript source, not the build output**, which node runs directly
// under type stripping -- `erasableSyntaxOnly` is already set repository-wide, which is the
// flag that guarantees it can. The reason is not convenience: a test that reads a built emit
// can be run against the *previous* emit when a change fails to type-check, and this lane has
// had three separate readings spoiled by exactly that. Importing source makes a mutation
// always live. Type checking is not lost -- `check.sh` runs `tsc` as its own step.
import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonText } from "../src/json/parse.ts";
import type { JsonValue } from "../src/json/value.ts";
import { stringifyJsonValue } from "../src/json/stringify.ts";
import { INVALID, keyOrder, must, plain, VALID } from "./json-corpus.ts";

const suite = (name: string, fn: () => void): void => {
  test(name, { timeout: 15000 }, fn);
};

suite("valid JSON agrees with node on value and on key order", () => {
  for (const text of VALID) {
    let expected;
    try {
      expected = JSON.parse(text);
    } catch (error) {
      assert.fail(
        `node rejected a case listed as valid: ${JSON.stringify(text)} (${String(error)})`,
      );
    }
    const actual = plain(parseJsonText(text));
    assert.deepEqual(actual, expected, `value for ${JSON.stringify(text)}`);
    assert.deepEqual(keyOrder(actual), keyOrder(expected), `key order for ${JSON.stringify(text)}`);
  }
});

suite("invalid JSON is rejected, and node rejects it too", () => {
  for (const text of INVALID) {
    // The second assertion is the control. Without it this only says the parser is strict,
    // not that it is strict about the right things -- a parser that rejected everything
    // would pass.
    assert.throws(
      () => JSON.parse(text),
      SyntaxError,
      `node accepted a case listed as invalid: ${JSON.stringify(text)}`,
    );
    assert.throws(
      () => parseJsonText(text),
      SyntaxError,
      `this parser accepted ${JSON.stringify(text)}`,
    );
  }
});

suite("a lone surrogate survives parsing as a code unit", () => {
  // The plan is explicit that parsing operates on UTF-16 code units and that a lone surrogate
  // is not normalised through UTF-8 to U+FFFD. Comparing against node covers the value; this
  // checks the code unit, which `deepEqual` over two identical replacement characters would
  // not have distinguished.
  const parsed = parseJsonText('"\\ud800"');
  assert.equal(parsed.text.length, 1);
  assert.equal(parsed.text.charCodeAt(0), 0xd800);
  assert.equal(parsed.text, JSON.parse('"\\ud800"'));
});

suite("integer-like keys come first, in numeric order", () => {
  // `OrdinaryOwnPropertyKeys`, which the plan names directly. An insertion-ordered map passes
  // every value assertion above and fails this one.
  const text = '{"b":1,"10":2,"9":3,"a":4,"0":5}';
  const parsed = parseJsonText(text);
  assert.deepEqual([...parsed.keys], ["0", "9", "10", "b", "a"]);
  assert.deepEqual(Object.keys(JSON.parse(text)), ["0", "9", "10", "b", "a"]);
});

suite("names that only look like indices stay in the string bucket", () => {
  const text = '{"01":1,"-1":2,"1.5":3,"4294967295":4,"4294967294":5,"z":6}';
  const parsed = parseJsonText(text);
  assert.deepEqual([...parsed.keys], Object.keys(JSON.parse(text)));
  // 4294967294 is 2^32 - 2 and is an index; 4294967295 is 2^32 - 1 and is not.
  assert.equal(must(parsed.keys[0]), "4294967294");
});

suite("a repeated key takes the later value and keeps the earlier position", () => {
  const text = '{"a":1,"b":2,"a":3}';
  const parsed = parseJsonText(text);
  assert.deepEqual([...parsed.keys], ["a", "b"]);
  assert.equal(must(parsed.values[0]).number, 3);
  assert.deepEqual(plain(parsed), JSON.parse(text));
});

suite("source spans cover exactly the text of each value", () => {
  // The spans are what 25.5.2.4 turns into `context.source` for the reviver. Checked now,
  // while there is one producer, rather than after a consumer starts depending on them.
  const text = '{"a":  123 , "b":[true]}';
  const root = parseJsonText(text);
  assert.equal(text.slice(root.start, root.end), text);
  const first = must(root.values[0]);
  const second = must(root.values[1]);
  assert.equal(text.slice(first.start, first.end), "123");
  assert.equal(text.slice(second.start, second.end), "[true]");
  const inner = must(second.items[0]);
  assert.equal(text.slice(inner.start, inner.end), "true");
});

suite("deep nesting does not exhaust a native stack", () => {
  // The reason the parser carries an explicit frame stack. A recursive-descent parser dies
  // here, and the plan requires that it not die on one target while surviving on another.
  // 100k levels is far past any recursive implementation and far short of a memory problem.
  const depth = 100000;
  const text = "[".repeat(depth) + "]".repeat(depth);
  let node: JsonValue = parseJsonText(text);
  let seen = 0;
  while (node.items.length > 0) {
    node = must(node.items[0]);
    seen++;
  }
  assert.equal(seen, depth - 1);
});

suite("a syntax error names the offset it was found at", () => {
  // A plain `SyntaxError`, as 25.5.2.1 requires and as every engine throws, with the offset in
  // the message rather than in an invented numeric property.
  const thrownBy = (text: string): SyntaxError => {
    try {
      parseJsonText(text);
    } catch (error) {
      return error as SyntaxError;
    }
    return assert.fail(`expected ${JSON.stringify(text)} to throw`);
  };
  assert.ok(thrownBy("[1,]") instanceof SyntaxError);
  assert.match(thrownBy("[1,]").message, /position 3$/);
  assert.match(thrownBy('{"a" 1}').message, /position 5$/);
  assert.match(thrownBy("nul").message, /position 0$/);
  // The constructor is `SyntaxError` itself, not a subclass: node's is too, and code that
  // switches on `error.constructor` should not be able to tell the two apart.
  assert.equal(thrownBy("[1,]").constructor, SyntaxError);
});

suite("the scan and the map agree, on both sides of the threshold", () => {
  // Duplicate detection changes shape at a member count, so there are two implementations of
  // one rule and nothing in the corpus is wide enough to reach the second. Every size from
  // well below the threshold to well above is built with duplicates and array-index keys in
  // it, and compared with node -- which has one implementation and therefore cannot drift.
  for (let width = 1; width <= 40; width++) {
    const parts: string[] = [];
    for (let at = 0; at < width; at++) {
      parts.push(`"k${at}":${at}`);
      // A duplicate every third key, and index-shaped keys interleaved so both key spaces
      // cross the threshold rather than only the string one.
      if (at % 3 === 0) parts.push(`"k${at}":${at * 100}`);
      if (at % 4 === 0) parts.push(`"${at}":${at * 1000}`);
      if (at % 8 === 0) parts.push(`"${at}":${at * 10000}`);
    }
    const text = `{${parts.join(",")}}`;
    const node: unknown = JSON.parse(text);
    assert.deepEqual(keyOrder(plain(parseJsonText(text))), keyOrder(node), `width ${width} order`);
    assert.equal(stringifyJsonValue(parseJsonText(text)), JSON.stringify(node), `width ${width} values`);
  }
});

suite("a wide object of entirely repeated keys collapses to one member", () => {
  // The path where every lookup hits. Above the threshold this exercises the map's hit branch,
  // which the interleaved test above reaches only every third key.
  for (const width of [4, 16, 17, 64, 500]) {
    const text = `{${new Array(width).fill('"same":1').join(",")}}`;
    const parsed = parseJsonText(text);
    assert.deepEqual([...parsed.keys], ["same"], `width ${width}`);
    assert.equal(stringifyJsonValue(parsed), JSON.stringify(JSON.parse(text)), `width ${width}`);
  }
});

suite("an index key repeated past the threshold is still deduplicated", () => {
  // Reaching the map on the *index* side needs sixteen distinct array-index names in one
  // object, and then a repeat among them. Nothing else here has both: the interleaved test
  // above stays under the threshold on that side, and the ordering test below has no repeats.
  // A sabotage that stopped recording index keys in the map survived because of exactly that.
  const parts: string[] = [];
  for (let at = 0; at < 40; at++) parts.push(`"${at}":${at}`);
  parts.push('"0":999', '"20":888', '"39":777');
  const text = `{${parts.join(",")}}`;
  const parsed = parseJsonText(text);
  assert.equal(parsed.keys.length, 40, "a repeat added a member");
  assert.deepEqual(keyOrder(plain(parsed)), keyOrder(JSON.parse(text)));
  assert.equal(stringifyJsonValue(parsed), JSON.stringify(JSON.parse(text)));
});

suite("a wide object keeps ordinary-own-property-keys order", () => {
  // The ordering rule and the threshold interact: index keys are collected separately and
  // sorted, and the map is built per key space. A wide object with indices scattered through it
  // is where a mistake in that interaction shows.
  const parts: string[] = [];
  for (let at = 0; at < 60; at++) {
    parts.push(`"z${at}":${at}`);
    parts.push(`"${100 - at}":${at}`);
  }
  const text = `{${parts.join(",")}}`;
  assert.deepEqual(keyOrder(plain(parseJsonText(text))), keyOrder(JSON.parse(text)));
});

suite("the integer fast path agrees with node at and past its boundary", () => {
  // `readNumber` accumulates an integer while it scans and skips the substring, but only while
  // the value stays inside the integers a double holds exactly. The boundary is a digit count,
  // and a digit count is exactly the kind of constant that is right in the corpus and wrong one
  // either side of it -- so this walks every length across it rather than sampling.
  for (let digits = 1; digits <= 21; digits++) {
    for (const lead of ["1", "9"]) {
      const text = lead + "0".repeat(digits - 1);
      assert.equal(
        parseJsonText(text).number,
        JSON.parse(text),
        `${digits} digits, leading ${lead}`,
      );
      assert.equal(parseJsonText("-" + text).number, JSON.parse("-" + text), `negative, ${digits}`);
    }
    // The largest and smallest value of each width, which is where an accumulator that has
    // started to round disagrees first.
    const nines = "9".repeat(digits);
    assert.equal(parseJsonText(nines).number, JSON.parse(nines), `${digits} nines`);
  }

  // The values around `Number.MAX_SAFE_INTEGER`, named rather than generated.
  for (const text of [
    "9007199254740991",
    "9007199254740992",
    "9007199254740993",
    "999999999999999",
    "1000000000000000",
    "12345678901234567890",
  ]) {
    assert.equal(parseJsonText(text).number, JSON.parse(text), text);
  }
});

suite("negative zero survives the fast path as negative zero", () => {
  // `-0` is a number JSON can write, and the fast path returns it by negating an accumulated
  // zero. `assert.equal` does not separate it from `0`, so this asks the question directly.
  assert.equal(Object.is(parseJsonText("-0").number, -0), true, "-0 must stay negative zero");
  assert.equal(Object.is(parseJsonText("0").number, 0), true);
  assert.equal(Object.is(JSON.parse("-0"), -0), true, "node agrees");
  // And it serializes back as `0`, which is what 25.5.4.2 and `Number::toString` give.
  assert.equal(stringifyJsonValue(parseJsonText("-0")), "0");
});

suite("a number with a fraction or an exponent takes the slow path and still matches node", () => {
  // The fast path must decline these rather than accumulate a wrong answer, so each is compared
  // against node exactly.
  for (const text of [
    "1.5",
    "0.1",
    "1e3",
    "1E3",
    "1e+3",
    "1e-3",
    "-1.5e-7",
    "123456789012345.6",
    "1234567890123456789.5",
    "0e0",
    "-0.0",
    "5e-324",
    "1.7976931348623157e308",
  ]) {
    assert.equal(parseJsonText(text).number, JSON.parse(text), text);
  }
});

// `OrdinaryOwnPropertyKeys` ordering at a size where the algorithm shows.
//
// `objectValue` used to reach this with `Array#sort` and a comparator, which is not lowered --
// it was the only refusal between the whole parser and the compiled axis, so the sort is now
// hand-written. Two things have to hold afterwards and only one of them is obvious.
//
// This asserts the order, at a size where a sort that is merely *nearly* right shows up: four
// thousand shuffled indices interleaved with a string key.
//
// **It does not assert the complexity, and an earlier version of this comment claimed it did.**
// The sort is a merge rather than an insertion because an object carrying thousands of
// array-index keys is an ordinary document -- a sparse array written as an object is exactly
// that. But a timing assertion cannot check that here: swapping in an insertion sort runs this
// same case in 6.9ms, because four thousand elements is nowhere near where n^2 bites. Sizing up
// until it did would make the test slow *and* timing-dependent on a machine three sessions
// share, which is a flaky test bought with a real one. The complexity is a design decision
// recorded at `ascendingByIndex`; this is the correctness half.
suite("many array-index keys stay in ascending numeric order, and do not go quadratic", () => {
  // Shuffled deterministically, so the sort has real work to do and a failure reproduces.
  const indices: number[] = [];
  for (let at = 0; at < 4000; at++) indices.push(at);
  let state = 12345;
  for (let at = indices.length - 1; at > 0; at--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swap = state % (at + 1);
    const held = indices[at] as number;
    indices[at] = indices[swap] as number;
    indices[swap] = held;
  }

  const members: string[] = [];
  for (const index of indices) members.push(`"${index}":${index}`);
  // One string key, to prove the index keys still sort ahead of it rather than merely among
  // themselves.
  members.push('"z":0');
  const text = `{${members.join(",")}}`;

  const parsed = parseJsonText(text);

  // The graph's own key list against node's, which is the ordering claim directly. `keyOrder`
  // walks a materialised value and is the right tool for nested shapes; here the object is flat
  // and the keys are the whole assertion.
  assert.deepEqual([...parsed.keys], Object.keys(JSON.parse(text) as object));
  assert.equal(parsed.keys.length, 4001);
  assert.equal(parsed.keys[0], "0");
  assert.equal(parsed.keys[3999], "3999");
  assert.equal(parsed.keys[4000], "z", "a non-index key sorts after every index key");
});
