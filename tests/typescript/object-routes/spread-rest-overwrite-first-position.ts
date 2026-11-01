/*---
description: "Later spreads replace values without moving existing string keys and still read overwritten getters."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-record, ts-accessors, ts-spread]
---*/
// Two Record sources cross one object literal; node reads all earlier getters, sorts newly introduced integer keys and retains each string key at its first position.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type CopyRecord = Record<string, CopyValue>;
function inspect(input: CopyValue, mode: string): void {
  const log: unknown[] = []; let left: CopyRecord = {}, right: CopyRecord = {};
  if (mode === "getters") {
    left = { get keep(): CopyValue { log.push("left.keep", input); return input; }, get 10(): CopyValue { log.push("left.10", replacement); return replacement; },
      get first(): CopyValue { log.push("left.first", null); return null; }, get 2(): CopyValue { log.push("left.2", input); return input; } };
    right = { get keep(): CopyValue { log.push("right.keep", undefined); return undefined; }, get last(): CopyValue { log.push("right.last", input); return input; },
      get 2(): CopyValue { log.push("right.2", replacement); return replacement; }, get 1(): CopyValue { log.push("right.1", first); return first; } };
  } else if (mode !== "empty") { left = { keep: input, "10": replacement, first: null, "2": input }; right = { keep: undefined, last: input, "2": replacement, "1": first }; }
  if (mode === "frozen") { Object.freeze(left); Object.freeze(right); }
  const leftKeys = mode === "empty" ? [] : ["2", "10", "keep", "first"], rightKeys = mode === "empty" ? [] : ["1", "2", "keep", "last"];
  const copy: CopyRecord = { keep: first, ...left, gap: input, ...right, tail: null };
  const keys = mode === "empty" ? ["keep", "gap", "tail"] : ["1", "2", "10", "keep", "first", "gap", "last", "tail"];
  const values: CopyValue[] = mode === "empty" ? [first, input, null] : [first, replacement, replacement, undefined, null, input, input, null];
  order(copy, keys); order(left, leftKeys); order(right, rightKeys); same(Object.is(copy, left), false); same(Object.is(copy, right), false);
  for (let at = 0; at < keys.length; at++) same(copy[keys[at]], values[at]);
  const expected: unknown[] = mode === "getters" ? ["left.2", input, "left.10", replacement, "left.keep", input, "left.first", null, "right.1", first, "right.2", replacement, "right.keep", undefined, "right.last", input] : [];
  assert.compareArray(log, expected);
}
for (const input of inputs) for (const mode of ["empty", "plain", "getters", "frozen"]) inspect(input, mode);
