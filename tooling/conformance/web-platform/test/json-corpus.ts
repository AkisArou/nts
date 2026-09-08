import assert from "node:assert/strict";

import type { JsonValue } from "../../../../runtime/web-platform/src/json/value.ts";

// The shared JSON corpora, and the helpers that read a graph.
//
// One list, imported by every JSON test, because two copies of "valid JSON" drift and the
// drift is invisible: a case dropped from one file still passes in the other. The helpers are
// here for the same reason -- `plain` in two files is two chances to get `__proto__` wrong.
//
// Every control character and space-like character is a `\u` escape. These are exactly the
// cases where the byte is the point, and a raw one is unreadable in a diff.

/** Text that is valid per ECMA-404, so node parses it and so must this implementation. */
export const VALID: readonly string[] = [
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


/**
 * Text that is not valid JSON, most of it valid JavaScript.
 *
 * The corpus is only meaningful alongside the assertion that node rejects each one too:
 * without that control it says the parser is strict, not that it is strict about the right
 * things, and a parser that rejected everything would pass.
 */
export const INVALID: readonly string[] = [
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


/**
 * An indexed read that is known to be in range.
 *
 * `noUncheckedIndexedAccess` types every index as `T | undefined`, which is right in general
 * and noise in a test that has just asserted the length.
 */
export function must<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  return value as T;
}

/**
 * The erased graph as an ordinary value, so it can be compared with node's parse result.
 *
 * Properties are defined, not assigned. 25.5.2 builds objects with `CreateDataPropertyOrThrow`,
 * and the difference is observable at exactly one key: `out["__proto__"] = v` sets the
 * prototype and creates no own property. A plain assignment here disagreed with node for
 * `{"__proto__":1}` on the first run.
 *
 * A `hole` becomes a genuine array hole, which is what a reviver's deletion produces.
 */
export function plain(node: JsonValue): unknown {
  switch (node.kind) {
    case "null":
      return null;
    case "boolean":
      return node.boolean;
    case "number":
      return node.number;
    case "string":
    case "raw":
      return node.text;
    case "hole":
      return undefined;
    case "array": {
      const out: unknown[] = [];
      out.length = node.items.length;
      for (let at = 0; at < node.items.length; at++) {
        const item = must(node.items[at]);
        if (item.kind !== "hole") out[at] = plain(item);
      }
      return out;
    }
    default: {
      const out: Record<string, unknown> = {};
      for (let at = 0; at < node.keys.length; at++) {
        Object.defineProperty(out, must(node.keys[at]), {
          value: plain(must(node.values[at])),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return out;
    }
  }
}

/**
 * The key order of a value, as a comparable shape.
 *
 * `deepStrictEqual` does not compare key order, and key order is observable — `Object.keys`,
 * `for...in` and `JSON.stringify` all follow it — so it is walked separately.
 */
export function keyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keyOrder);
  if (value === null || typeof value !== "object") return null;
  return {
    keys: Object.keys(value),
    children: Object.values(value).map(keyOrder),
  };
}
