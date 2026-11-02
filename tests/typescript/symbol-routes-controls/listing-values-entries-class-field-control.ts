/*---
description: String-ID record control for Values and entries omit symbol fields after a typed holder carries literal and class instances.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-null-undefined, ts-tuples, ts-arrow-functions]
---*/
// A Holder Row field carries empty objects, literals and instances with symbol fields; node enumerates only ordered string values and entries.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first = "token:first", second = "token:second";
interface Row { text: Record<string, number | string>; fields: Record<string, number | undefined>; order: string[]; }
class Holder { row: Row; constructor(row: Row) { this.row = row; } }
function makeTarget(input: number, mode: string): Holder { return new Holder(mode === "empty" ? { text: {}, fields: {}, order: [] } : { text: { tail: "tail", "2": input }, fields: { [first]: input, [second]: undefined }, order: [first, second] }); }
function keys(target: Holder): string[] { return Object.keys(target.row.text); }
function values(target: Holder): unknown[] { const result: unknown[] = []; for (const key of keys(target)) result.push(target.row.text[key]); return result; }
function entries(target: Holder): [string, unknown][] { const result: [string, unknown][] = []; for (const key of keys(target)) result.push([key, target.row.text[key]]); return result; }
function tokens(target: Holder): string[] { return target.row.order.slice(); }
function read(target: Holder): number | undefined { return target.row.fields[first]; }
for (const input of [-0, NaN, 17]) for (const mode of ["empty", "literal", "class"]) {
  const target = makeTarget(input, mode), pairs = entries(target);
  assert.compareArray(keys(target), mode === "empty" ? [] : ["2", "tail"]); assert.compareArray(values(target), mode === "empty" ? [] : [input, "tail"]);
  assert.compareArray(pairs.map(entry => entry[0]), mode === "empty" ? [] : ["2", "tail"]); assert.compareArray(pairs.map(entry => entry[1]), mode === "empty" ? [] : [input, "tail"]);
  assert.compareArray(tokens(target), mode === "empty" ? [] : [first, second]); same(read(target), mode === "empty" ? undefined : input); same(Object.is(first, second), false);
}
