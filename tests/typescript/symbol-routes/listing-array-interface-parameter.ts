/*---
description: Mixed symbol and string additions on a typed sparse array retain array own-key order and JSON index behavior.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-json-stringify, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// An Indexed array parameter carries holes, a label and same-description symbol fields; node lists indices before length and label while JSON serializes only indices.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first: unique symbol = Symbol("slot"), second: unique symbol = Symbol("slot");
interface Indexed extends Array<number | undefined> { label?: string; [first]?: number; [second]?: number; }
function makeTarget(input: number, length: number): Indexed { const target: Indexed = []; target.length = length; if (length > 0) target[length - 1] = input; target[second] = 11; target.label = "tag"; target[first] = input; return target; }
function keys(target: Indexed): string[] { return Object.keys(target); }
function tokens(target: Indexed): symbol[] { return Object.getOwnPropertySymbols(target); }
function all(target: Indexed): PropertyKey[] { return Reflect.ownKeys(target); }
function values(target: Indexed): unknown[] { return Object.values(target); }
function serialize(target: Indexed): string | undefined { return JSON.stringify(target); }
function read(target: Indexed, key: typeof first | typeof second): number | undefined { return target[key]; }
for (const input of [-0, NaN, 17]) for (const length of [0, 1, 4]) {
  const target = makeTarget(input, length), value = Number.isNaN(input) ? "null" : String(input);
  assert.compareArray(keys(target), length === 0 ? ["label"] : [String(length - 1), "label"]);
  assert.compareArray(tokens(target), [second, first]); assert.compareArray(all(target), length === 0 ? ["length", "label", second, first] : [String(length - 1), "length", "label", second, first]);
  assert.compareArray(values(target), length === 0 ? ["tag"] : [input, "tag"]); same(serialize(target), length === 0 ? "[]" : length === 1 ? "[" + value + "]" : "[null,null,null," + value + "]");
  same(read(target, first), input); same(read(target, second), 11); same(Object.is(first, second), false);
}
