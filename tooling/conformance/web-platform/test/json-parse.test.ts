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

import { parseJsonText } from "../../../../runtime/web-platform/src/json/parse.ts";
import type { JsonValue } from "../../../../runtime/web-platform/src/json/value.ts";

const suite = (name: string, fn: () => void): void => {
  test(name, { timeout: 15000 }, fn);
};

/** The erased graph as an ordinary value, so it can be compared with node's parse result. */
function plain(node: JsonValue): unknown {
  switch (node.kind) {
    case "null":
      return null;
    case "boolean":
      return node.boolean;
    case "number":
      return node.number;
    case "string":
      return node.text;
    case "array":
      return node.items.map(plain);
    default: {
      const out = {};
      for (let at = 0; at < node.keys.length; at++) {
        // `defineProperty`, not assignment. 25.5.2 builds objects with
        // `CreateDataPropertyOrThrow`, and the difference is observable at exactly one key:
        // `out["__proto__"] = v` sets the prototype and creates no own property, so a plain
        // assignment here silently disagreed with node for `{"__proto__":1}` — the case that
        // is in the corpus for this reason.
        Object.defineProperty(out, node.keys[at], {
          value: plain(node.values[at]),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return out;
    }
  }
}

/** Key order is observable and `deepStrictEqual` does not check it, so walk it separately. */
function keyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keyOrder);
  if (value === null || typeof value !== "object") return null;
  return { keys: Object.keys(value), children: Object.values(value).map(keyOrder) };
}

const VALID = [
  "null",
  "true",
  "false",
  '""',
  '"a"',
  "0",
  "-0",
  "1",
  "-1",
  "1.5",
  "-1.5",
  "1e3",
  "1E3",
  "1e+3",
  "1e-3",
  "1.5e300",
  "1e400",
  "0.0",
  "-0.0",
  "123456789012345678901234567890",
  "1e-400",
  "[]",
  "{}",
  "[1]",
  "[1,2,3]",
  '{"a":1}',
  '{"a":1,"b":2}',
  '{"a":{"b":{"c":[1,2,{"d":null}]}}}',
  "[[[[[1]]]]]",
  '{"":1}',
  '{"a":[],"b":{}}',
  '"\\u0000"',
  '"\\u001f"',
  '"\\"\\\\\\/\\b\\f\\n\\r\\t"',
  '"\\ud83d\\ude00"',
  '"\\ud800"',
  '"\\udc00"',
  '"\\ud800a"',
  '"\\udfff\\ud800"',
  '"é"',
  '"日本語"',
  " \t\r\n null \t\r\n ",
  "[ 1 , 2 ]",
  '{ "a" : 1 }',
  '{"b":1,"0":2,"1":3,"a":4}',
  '{"a":1,"a":2}',
  '{"01":1,"-1":2,"1.5":3,"4294967295":4,"4294967294":5}',
  '{"__proto__":1}',
  '{"constructor":1,"toString":2}',
];

const INVALID = [
  // Nothing, and not-quite-literals.
  "",
  " ",
  "\n",
  "nul",
  "tru",
  "fals",
  "NULL",
  "True",
  "undefined",
  // Numbers JavaScript accepts and JSON does not.
  "NaN",
  "Infinity",
  "-Infinity",
  "+1",
  "01",
  "-01",
  ".5",
  "5.",
  "1.",
  "1.e3",
  "1e",
  "1e+",
  "1e-",
  "--1",
  "0x10",
  "0b1",
  "1_000",
  // Object and array syntax JavaScript accepts and JSON does not.
  "'a'",
  "a",
  "{a:1}",
  "{'a':1}",
  '{"a" 1}',
  '{"a":}',
  "{:1}",
  "[1,]",
  "[,1]",
  "[1 2]",
  '{"a":1,}',
  "{,}",
  "[}",
  "{]",
  // Strings.
  '"',
  '"a',
  '"\\"',
  '"\\x41"',
  '"\\u12"',
  '"\\u12g4"',
  '"\\q"',
  '"\n"',
  '"\t"',
  '"\u0000"',
  // More than one value, and non-JSON whitespace between tokens.
  "[1] [2]",
  "1 2",
  "{} {}",
  "nullnull",
  "\ufeff{}",
  "\u00a0null",
  "\u2028null",
  // Truncated, and comments.
  "[",
  "{",
  '{"a"',
  '{"a":',
  "[1",
  "/*c*/1",
  "1//c",
];

suite("valid JSON agrees with node on value and on key order", () => {
  for (const text of VALID) {
    let expected;
    try {
      expected = JSON.parse(text);
    } catch (error) {
      assert.fail(
        `node rejected a case listed as valid: ${JSON.stringify(text)} (${error.message})`,
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
  assert.equal(parsed.keys[0], "4294967294");
});

suite("a repeated key takes the later value and keeps the earlier position", () => {
  const text = '{"a":1,"b":2,"a":3}';
  const parsed = parseJsonText(text);
  assert.deepEqual([...parsed.keys], ["a", "b"]);
  assert.equal(parsed.values[0].number, 3);
  assert.deepEqual(plain(parsed), JSON.parse(text));
});

suite("source spans cover exactly the text of each value", () => {
  // The spans are what 25.5.2.4 turns into `context.source` for the reviver. Checked now,
  // while there is one producer, rather than after a consumer starts depending on them.
  const text = '{"a":  123 , "b":[true]}';
  const root = parseJsonText(text);
  assert.equal(text.slice(root.start, root.end), text);
  assert.equal(text.slice(root.values[0].start, root.values[0].end), "123");
  assert.equal(text.slice(root.values[1].start, root.values[1].end), "[true]");
  assert.equal(text.slice(root.values[1].items[0].start, root.values[1].items[0].end), "true");
});

suite("deep nesting does not exhaust a native stack", () => {
  // The reason the parser carries an explicit frame stack. A recursive-descent parser dies
  // here, and the plan requires that it not die on one target while surviving on another.
  // 100k levels is far past any recursive implementation and far short of a memory problem.
  const depth = 100000;
  const text = "[".repeat(depth) + "]".repeat(depth);
  let node = parseJsonText(text);
  let seen = 0;
  while (node.items.length > 0) {
    node = node.items[0];
    seen++;
  }
  assert.equal(seen, depth - 1);
});

suite("a syntax error names the offset it was found at", () => {
  // A plain `SyntaxError`, as 25.5.2.1 requires and as every engine throws, with the offset in
  // the message rather than in an invented numeric property.
  const thrownBy = (text) => {
    try {
      parseJsonText(text);
    } catch (error) {
      return error;
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
