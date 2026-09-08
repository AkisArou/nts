// The arbitrary-value bridge, against node.
//
// Everything here is a direct comparison with the host `JSON`, because for this file the host
// is not merely an oracle -- it is the same specification clause running on the same values, so
// a disagreement is a bug in one of them rather than a profile difference. The cases that are
// not a comparison are the ones where node's behaviour is unobservable through `JSON.stringify`
// alone: which errors propagate, and what `toPlainValue` builds.
import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonText } from "../src/json/parse.ts";
import { stringifyPlain, toPlainValue } from "../src/json/plain.ts";
import { jsonRawJSON } from "../src/json/json.ts";
import { VALID } from "./json-corpus.ts";

const suite = (name: string, fn: () => void): void => {
  test(name, { timeout: 15000 }, fn);
};

suite("serializing a parsed document matches node for the whole corpus", () => {
  for (const text of VALID) {
    const value: unknown = JSON.parse(text);
    assert.equal(stringifyPlain(value), JSON.stringify(value), `stringify of ${JSON.stringify(text)}`);
  }
});

suite("materializing a parsed graph matches what node parsed", () => {
  for (const text of VALID) {
    assert.deepEqual(toPlainValue(parseJsonText(text)), JSON.parse(text), `materialize ${JSON.stringify(text)}`);
  }
});

suite("a materialized object has ordinary prototypes and own keys in order", () => {
  // `deepEqual` is blind to both of these. `JSON.parse` produces objects with
  // `Object.prototype`, and a `__proto__` member is an own property rather than a prototype
  // change -- which is what separates `CreateDataPropertyOrThrow` from assignment.
  const value = toPlainValue(parseJsonText('{"b":1,"2":2,"a":3,"0":4}'));
  assert.equal(Object.getPrototypeOf(value as object), Object.prototype);
  assert.deepEqual(Object.keys(value as object), Object.keys(JSON.parse('{"b":1,"2":2,"a":3,"0":4}')));
  assert.deepEqual(Object.keys(value as object), ["0", "2", "b", "a"]);

  const proto = toPlainValue(parseJsonText('{"__proto__":{"x":1}}')) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(proto), Object.prototype, "the prototype was not replaced");
  assert.deepEqual(Object.getOwnPropertyNames(proto), ["__proto__"]);
  assert.equal(Object.getOwnPropertyDescriptor(proto, "__proto__")?.enumerable, true);
});

suite("an array materializes with its length and its indices", () => {
  const value = toPlainValue(parseJsonText("[1,[2],{}]")) as unknown[];
  assert.equal(Array.isArray(value), true);
  assert.equal(value.length, 3);
  assert.deepEqual(value, [1, [2], {}]);
});

const TRANSFORMED: unknown[] = [
  { toJSON: () => 42 },
  { toJSON: (key: string) => key },
  new Date(0),
  { at: new Date(86400000) },
  [new Date(0)],
  { toJSON: () => ({ nested: [1, 2] }) },
  Object.create({ toJSON: () => "inherited" }),
];

suite("toJSON is honoured wherever node honours it", () => {
  for (const value of TRANSFORMED) {
    assert.equal(stringifyPlain(value), JSON.stringify(value), `toJSON for ${Object.prototype.toString.call(value)}`);
  }
});

suite("values with no serialization are omitted, or null inside an array", () => {
  const cases: unknown[] = [
    undefined,
    Symbol("x"),
    () => 1,
    { a: undefined, b: 1, c: Symbol("y"), d: () => 1 },
    [undefined, 1, Symbol("y"), () => 1],
    [],
    {},
  ];
  for (let at = 0; at < cases.length; at++) {
    // Labelled by index rather than by value: `String(aSymbol)` throws, and a label that
    // throws replaces the assertion with an error about the label.
    assert.equal(stringifyPlain(cases[at]), JSON.stringify(cases[at]), `omission case ${at}`);
  }
});

suite("a boxed primitive is unwrapped rather than serialized as an object", () => {
  const cases: unknown[] = [
    new Number(1),
    new String("a"),
    new Boolean(true),
    { n: new Number(-0), s: new String(""), b: new Boolean(false) },
    [new Number(NaN)],
  ];
  for (const value of cases) {
    assert.equal(stringifyPlain(value), JSON.stringify(value), "boxed primitive");
  }
});

suite("a BigInt is refused rather than dropped, exactly as node refuses it", () => {
  assert.throws(() => stringifyPlain(1n), TypeError);
  assert.throws(() => JSON.stringify(1n), TypeError);
  assert.throws(() => stringifyPlain({ a: 1n }), TypeError);
  assert.throws(() => JSON.stringify({ a: 1n }), TypeError);
  // A `toJSON` on a BigInt is reached before the refusal, so this one does not throw.
  const value = Object.assign(Object.create(null), {});
  void value;
  assert.equal(stringifyPlain({ a: { toJSON: () => 1 } }), '{"a":1}');
});

suite("a cycle is a TypeError, at whatever depth it closes", () => {
  const direct: Record<string, unknown> = {};
  direct.self = direct;
  const deep: Record<string, unknown> = { a: { b: {} } };
  ((deep.a as Record<string, unknown>).b as Record<string, unknown>).back = deep;
  const arrayCycle: unknown[] = [1];
  arrayCycle.push(arrayCycle);
  const mixed: Record<string, unknown> = { list: [] as unknown[] };
  (mixed.list as unknown[]).push(mixed);

  for (const value of [direct, deep, arrayCycle, mixed]) {
    assert.throws(() => stringifyPlain(value), TypeError, "cycle not caught");
    assert.throws(() => JSON.stringify(value), TypeError, "node agrees");
  }
});

suite("the same object twice is not a cycle", () => {
  // The stack holds the open containers, not every container seen. A shared subobject appears
  // twice and is serialized twice; only an enclosing container is a cycle. An implementation
  // using a seen-set rather than a stack rejects this valid document.
  const shared = { x: 1 };
  const value = { a: shared, b: shared, c: [shared, shared] };
  assert.equal(stringifyPlain(value), JSON.stringify(value));
});

suite("a throwing getter propagates its own error", () => {
  class CustomError extends Error {}
  const value = {
    get boom(): number {
      throw new CustomError("bar");
    },
  };
  assert.throws(() => stringifyPlain(value), CustomError);
  assert.throws(() => JSON.stringify(value), CustomError);
});

suite("a replacer sees the same keys, values and this as node's", () => {
  const shapes: unknown[] = [
    { a: 1, b: [1, 2], c: { d: null } },
    [1, [2, [3]]],
    { "": 0 },
    // A `toJSON` holder, so the log shows whether the replacer runs before or after step 2.
    { a: new Date(0) },
    // Boxed primitives, so the log shows whether step 4 runs before or after step 3. The
    // replacer must see the wrapper object, not the primitive: unwrapping first is invisible
    // to the output text and visible only here.
    { n: new Number(1), s: new String("a"), b: new Boolean(false) },
    [new Number(1)],
  ];
  for (const value of shapes) {
    const mine: string[] = [];
    const theirs: string[] = [];
    const record = (log: string[]) =>
      function (this: unknown, key: string, held: unknown): unknown {
        log.push(`${key}:${Array.isArray(held) ? "array" : typeof held}:${typeof this}`);
        return held;
      };
    assert.equal(
      stringifyPlain(value, { replacer: record(mine) }),
      JSON.stringify(value, record(theirs)),
    );
    assert.deepEqual(mine, theirs, "replacer call sequence");
  }
});

suite("a replacer that drops values matches node", () => {
  const value = { a: 1, b: 2, c: [1, 2, 3] };
  const drop = (key: string, held: unknown): unknown => (key === "b" || key === "1" ? undefined : held);
  assert.equal(stringifyPlain(value, { replacer: drop }), JSON.stringify(value, drop));
  assert.equal(stringifyPlain(value, { replacer: () => undefined }), JSON.stringify(value, () => undefined));
});

suite("a property list selects and orders keys as node does", () => {
  const value = { a: 1, b: 2, c: { a: 9, d: 8 } };
  for (const list of [["b", "a"], ["c", "a"], [], ["a", "zz"], ["d", "a"]]) {
    assert.equal(
      stringifyPlain(value, { propertyList: list }),
      JSON.stringify(value, list),
      `property list ${JSON.stringify(list)}`,
    );
  }
});

suite("the indent argument matches node for arbitrary values", () => {
  const shapes: unknown[] = [
    { a: 1, b: [1, 2], c: { d: { e: [] } } },
    [],
    {},
    [[], {}, [{}]],
    { a: {} },
  ];
  for (const space of [0, 1, 2, 10, 11, -1, NaN, "", "\t", "0123456789X"]) {
    for (const value of shapes) {
      assert.equal(
        stringifyPlain(value, { space }),
        JSON.stringify(value, null, space),
        `space ${JSON.stringify(space)}`,
      );
    }
  }
});

suite("the surrogate cases the fetch fixture pins come out byte for byte", () => {
  // `fetch/api/response/response-static-json.any.js` asserts these three as byte arrays, so
  // they are the exact strings that decide whether `Response.json` passes upstream.
  assert.equal(stringifyPlain("\u{1d306}"), '"\u{1d306}"');
  assert.equal(stringifyPlain("\udf06\ud834"), '"\\udf06\\ud834"');
  assert.equal(stringifyPlain("\udead"), '"\\udead"');
  for (const sample of ["\u{1d306}", "\udf06\ud834", "\udead"]) {
    assert.equal(stringifyPlain(sample), JSON.stringify(sample), "node agrees");
  }
});

suite("a rawJSON node splices its text into an arbitrary document", () => {
  const document = { a: jsonRawJSON("1e999"), b: [jsonRawJSON('"x"')] };
  assert.equal(stringifyPlain(document), '{"a":1e999,"b":["x"]}');
});

suite("deep nesting serializes and materializes without a native stack", () => {
  const depth = 20000;
  const text = "[".repeat(depth) + "]".repeat(depth);
  const materialized = toPlainValue(parseJsonText(text));
  assert.equal(stringifyPlain(materialized), text);
});
