/*---
description: Values and entries omit symbol fields after a typed holder carries literal and class instances.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-null-undefined, ts-tuples, ts-arrow-functions, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A Holder Row field carries empty objects, literals and instances with symbol fields; node enumerates only ordered string values and entries.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first: unique symbol = Symbol("hidden"), second: unique symbol = Symbol("hidden");
interface Row { [first]?: number; [second]?: number; "2"?: number; tail?: string; }
class Instance implements Row { [first]: number; tail: string = "tail"; "2": number; [second]: number | undefined = undefined; constructor(input: number) { this[first] = input; this["2"] = input; } }
class Holder { row: Row; constructor(row: Row) { this.row = row; } }
function makeTarget(input: number, mode: string): Holder { return new Holder(mode === "empty" ? {} : mode === "class" ? new Instance(input) : { [first]: input, tail: "tail", "2": input, [second]: undefined }); }
function keys(target: Holder): string[] { return Object.keys(target.row); }
function values(target: Holder): unknown[] { return Object.values(target.row); }
function entries(target: Holder): [string, unknown][] { return Object.entries(target.row); }
function tokens(target: Holder): symbol[] { return Object.getOwnPropertySymbols(target.row); }
function read(target: Holder): number | undefined { return target.row[first]; }
for (const input of [-0, NaN, 17]) for (const mode of ["empty", "literal", "class"]) {
  const target = makeTarget(input, mode), pairs = entries(target);
  assert.compareArray(keys(target), mode === "empty" ? [] : ["2", "tail"]); assert.compareArray(values(target), mode === "empty" ? [] : [input, "tail"]);
  assert.compareArray(pairs.map(entry => entry[0]), mode === "empty" ? [] : ["2", "tail"]); assert.compareArray(pairs.map(entry => entry[1]), mode === "empty" ? [] : [input, "tail"]);
  assert.compareArray(tokens(target), mode === "empty" ? [] : [first, second]); same(read(target), mode === "empty" ? undefined : input); same(Object.is(first, second), false);
}
