/*---
description: Explicit attribute-record control for A typed array field omits a hidden index from property lists while JSON still serializes the index by position.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-interfaces, ts-record, ts-spread, ts-arrow-functions]
---*/
// A number-array field carries a nonenumerable index; node keeps the index and length, filters property enumeration, and serializes every JSON array position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
type Series = Record<string, Cell>;
interface Holder { items: Series; }
function make(values: number[]): Series { const source: Series = {}; for (let i = 0; i < values.length; i++) source[String(i)] = { value: values[i], writable: true, enumerable: i !== 1, configurable: true }; source.length = { value: values.length, writable: true, enumerable: false, configurable: false }; return source; }
function names(holder: Holder): string[] { return Object.keys(holder.items); }
function keys(holder: Holder): string[] { return names(holder).filter(key => holder.items[key].enumerable); }
function values(holder: Holder): number[] { return keys(holder).map(key => holder.items[key].value); }
function json(holder: Holder): string | undefined { const items: number[] = []; for (let i = 0; i < holder.items.length.value; i++) items.push(holder.items[String(i)].value); return JSON.stringify(items); }
function read(holder: Holder, index: number): number { return holder.items[String(index)].value; }
function present(holder: Holder, index: number): boolean { return Object.hasOwn(holder.items, String(index)); }
function describe(holder: Holder, key: string): PropertyDescriptor | undefined { const entry = holder.items[key]; return entry === undefined ? undefined : { ...entry }; }
const inputs: number[][] = [[], [-0], [NaN], [1, 2, 3], [-0, NaN, 7]];
for (const input of inputs) {
  const holder: Holder = { items: make(input) }, all = input.map((_, index) => String(index)), visible = all.filter(key => key !== "1");
  assert.compareArray(names(holder), [...all, "length"]); assert.compareArray(keys(holder), visible); assert.compareArray(values(holder), input.filter((_, index) => index !== 1)); same(json(holder), JSON.stringify(input));
  for (let i = 0; i < input.length; i++) { same(read(holder, i), input[i]); same(present(holder, i), true); check(describe(holder, String(i)), input[i], true, i !== 1, true); }
  check(describe(holder, "length"), input.length, true, false, false); same(present(holder, input.length), false);
}
