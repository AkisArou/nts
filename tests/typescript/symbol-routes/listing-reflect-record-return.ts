/*---
description: Reflect own-key groups survive a typed Record return with interleaved string and symbol insertions.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-record, ts-type-aliases, ts-null-undefined, ts-symbols, ts-computed-keys]
---*/
// A returned Record carries mixed integer, string and same-description symbol keys; node lists integer keys first and symbol identities last in insertion order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first: symbol = Symbol("same"), second: symbol = Symbol("same");
type Target = Record<PropertyKey, number | undefined>;
function makeTarget(input: number, mode: string): Target {
  const target: Target = {}; if (mode === "empty") return target;
  target[mode === "forward" ? first : second] = input; target.tail = 11; target["10"] = 10;
  target[mode === "forward" ? second : first] = undefined; target["01"] = -0; target["2"] = 2; return target;
}
function keys(target: Target): string[] { return Object.keys(target); }
function tokens(target: Target): symbol[] { return Object.getOwnPropertySymbols(target); }
function all(target: Target): PropertyKey[] { return Reflect.ownKeys(target); }
function read(target: Target, key: PropertyKey): number | undefined { return target[key]; }
for (const input of [-0, NaN, 19]) for (const mode of ["empty", "forward", "reverse"]) {
  const target = makeTarget(input, mode), a = mode === "forward" ? first : second, b = mode === "forward" ? second : first;
  assert.compareArray(keys(target), mode === "empty" ? [] : ["2", "10", "tail", "01"]);
  assert.compareArray(tokens(target), mode === "empty" ? [] : [a, b]); assert.compareArray(all(target), mode === "empty" ? [] : ["2", "10", "tail", "01", a, b]);
  same(Object.is(first, second), false); same(read(target, a), mode === "empty" ? undefined : input); same(read(target, b), undefined);
  same(read(target, "2"), mode === "empty" ? undefined : 2); same(read(target, "10"), mode === "empty" ? undefined : 10);
  same(read(target, "tail"), mode === "empty" ? undefined : 11); same(read(target, "01"), mode === "empty" ? undefined : -0);
}
