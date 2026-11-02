/*---
description: String-ID record control for Mixed symbol and string additions on a typed sparse array retain array own-key order and JSON index behavior.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-json-stringify]
---*/
// An Indexed array parameter carries holes, a label and same-description symbol fields; node lists indices before length and label while JSON serializes only indices.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first = "token:first", second = "token:second";
interface Indexed { items: (number | undefined)[]; text: Record<string, string>; fields: Record<string, number>; order: string[]; }
function makeTarget(input: number, length: number): Indexed { const items: (number | undefined)[] = []; items.length = length; if (length > 0) items[length - 1] = input; return { items, text: { label: "tag" }, fields: { [second]: 11, [first]: input }, order: [second, first] }; }
function keys(target: Indexed): string[] { return Object.keys(target.items).concat(Object.keys(target.text)); }
function tokens(target: Indexed): string[] { return target.order.slice(); }
function all(target: Indexed): string[] { return Object.keys(target.items).concat(["length"], Object.keys(target.text), tokens(target)); }
function values(target: Indexed): unknown[] { const result: unknown[] = []; for (const key of Object.keys(target.items)) result.push(target.items[Number(key)]); for (const key of Object.keys(target.text)) result.push(target.text[key]); return result; }
function serialize(target: Indexed): string | undefined { return JSON.stringify(target.items); }
function read(target: Indexed, key: typeof first | typeof second): number | undefined { return target.fields[key]; }
for (const input of [-0, NaN, 17]) for (const length of [0, 1, 4]) {
  const target = makeTarget(input, length), value = Number.isNaN(input) ? "null" : String(input);
  assert.compareArray(keys(target), length === 0 ? ["label"] : [String(length - 1), "label"]);
  assert.compareArray(tokens(target), [second, first]); assert.compareArray(all(target), length === 0 ? ["length", "label", second, first] : [String(length - 1), "length", "label", second, first]);
  assert.compareArray(values(target), length === 0 ? ["tag"] : [input, "tag"]); same(serialize(target), length === 0 ? "[]" : length === 1 ? "[" + value + "]" : "[null,null,null," + value + "]");
  same(read(target, first), input); same(read(target, second), 11); same(Object.is(first, second), false);
}
