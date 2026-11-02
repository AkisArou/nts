/*---
description: A generic reader includes non-enumerable symbols in own-symbol and Reflect lists but never string listings.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-generics, ts-optional-properties, ts-null-undefined, ts-arrow-functions, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A Hidden constraint carries default-hidden and enumerable same-description symbol fields; node retains both identities regardless of enumerability.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first: unique symbol = Symbol("hidden"), second: unique symbol = Symbol("hidden");
interface Hidden { tail?: number; "1"?: number; [first]?: number; [second]?: number; }
function makeTarget(input: number, mode: string): Hidden { if (mode === "empty") return {}; const target: Hidden = { tail: 11, "1": input }; Object.defineProperty(target, first, { value: input, enumerable: mode === "shown" }); Object.defineProperty(target, second, { value: undefined }); return target; }
function inspect<T extends Hidden>(target: T) { return { strings: Object.keys(target), names: Object.getOwnPropertyNames(target), tokens: Object.getOwnPropertySymbols(target), all: Reflect.ownKeys(target) }; }
function read(target: Hidden, key: typeof first | typeof second): number | undefined { return target[key]; }
function enumerable(target: Hidden, key: symbol): boolean | undefined { const d = Object.getOwnPropertyDescriptor(target, key); return d === undefined ? undefined : d.enumerable; }
for (const input of [-0, NaN, 17]) for (const mode of ["empty", "hidden", "shown"]) {
  const target = makeTarget(input, mode), result = inspect(target);
  assert.compareArray(result.strings, mode === "empty" ? [] : ["1", "tail"]); assert.compareArray(result.names, mode === "empty" ? [] : ["1", "tail"]);
  assert.compareArray(result.tokens, mode === "empty" ? [] : [first, second]); assert.compareArray(result.all, mode === "empty" ? [] : ["1", "tail", first, second]);
  same(read(target, first), mode === "empty" ? undefined : input); same(read(target, second), undefined); same(Object.is(first, second), false);
  same(enumerable(target, first), mode === "empty" ? undefined : mode === "shown"); same(enumerable(target, second), mode === "empty" ? undefined : false);
}
