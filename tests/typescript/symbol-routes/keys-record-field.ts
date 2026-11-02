/*---
description: A symbol-indexed record held in a class field separates same-description keys from a string with that spelling.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-record, ts-null-undefined, ts-symbols, ts-computed-keys]
---*/
// A Holder field carries mixed PropertyKey records; node keeps runtime symbol identities distinct from the string same during reads and writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first: symbol = Symbol("same"), second: symbol = Symbol("same"), missing: symbol = Symbol("same");
class Holder { value: Record<PropertyKey, number | undefined>; constructor(value: Record<PropertyKey, number | undefined>) { this.value = value; } }
function makeTarget(input: number, count: number): Holder { const value: Record<PropertyKey, number | undefined> = { same: 91 }; if (count > 0) value[first] = input; if (count > 1) value[second] = undefined; return new Holder(value); }
function read(target: Holder, key: PropertyKey): number | undefined { return target.value[key]; }
function write(target: Holder, key: symbol, value: number): void { target.value[key] = value; }
function has(target: Holder, key: PropertyKey): boolean { return key in target.value; }
function tokens(target: Holder): symbol[] { return Object.getOwnPropertySymbols(target.value); }
function names(target: Holder): string[] { return Object.keys(target.value); }
for (const input of [-0, NaN, 13]) for (const count of [0, 1, 2]) {
  const target = makeTarget(input, count); same(Object.is(first, second), false);
  same(read(target, "same"), 91); same(read(target, first), count > 0 ? input : undefined); same(read(target, second), undefined);
  same(has(target, first), count > 0); same(has(target, second), count > 1); same(has(target, missing), false);
  assert.compareArray(tokens(target), count === 0 ? [] : count === 1 ? [first] : [first, second]); assert.compareArray(names(target), ["same"]);
  write(target, second, 43); write(target, first, -0);
  same(read(target, first), -0); same(read(target, second), 43); same(read(target, "same"), 91); same(has(target, missing), false);
  assert.compareArray(tokens(target), count === 0 ? [second, first] : [first, second]); assert.compareArray(names(target), ["same"]);
}
