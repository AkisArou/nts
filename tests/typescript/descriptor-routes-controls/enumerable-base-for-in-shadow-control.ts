/*---
description: Explicit attribute-record control for A base-class for-in route skips a nonenumerable own shadow and filters inherited descriptor flags.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-declare-field, ts-optional-properties, ts-record, ts-interfaces, ts-map-set, ts-spread, ts-arrow-functions]
---*/
// A child crosses a base-class parameter with integer and string properties; node skips hidden own data and does not reveal the same-named enumerable prototype property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
type Table = Record<string, Cell>;
class Parent { own: Table = {}; parent: Table = {}; }
class Child extends Parent {}
function cell(value: number, enumerable: boolean): Cell { return { value, writable: true, enumerable, configurable: true }; }
function make(value: number, show: boolean): Child { const source = new Child(); source.own = { "2": cell(value, true), tail: cell(7, true), shadow: cell(21, false) }; source.parent = { "1": cell(10, true), shadow: cell(20, true), inherited: cell(30, show) }; return source; }
function walk(source: Parent): string[] { const result: string[] = [], seen = new Set<string>(); for (const table of [source.own, source.parent]) for (const key of Object.keys(table)) { if (!seen.has(key) && table[key].enumerable) result.push(key); seen.add(key); } return result; }
function keys(source: Parent): string[] { return Object.keys(source.own).filter(key => source.own[key].enumerable); }
function names(source: Parent): string[] { return Object.keys(source.own); }
function read(source: Parent, key: "1" | "shadow" | "inherited"): number | undefined { const entry = source.own[key] ?? source.parent[key]; return entry === undefined ? undefined : entry.value; }
function describe(source: Parent, key: string, inherited = false): PropertyDescriptor | undefined { const entry = (inherited ? source.parent : source.own)[key]; return entry === undefined ? undefined : { ...entry }; }
for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const source: Parent = make(initial, show);
  assert.compareArray(walk(source), show ? ["2", "tail", "1", "inherited"] : ["2", "tail", "1"]); assert.compareArray(keys(source), ["2", "tail"]); assert.compareArray(names(source), ["2", "tail", "shadow"]);
  same(read(source, "shadow"), 21); same(read(source, "1"), 10); same(read(source, "inherited"), 30);
  check(describe(source, "2"), initial, true, true, true); check(describe(source, "tail"), 7, true, true, true); check(describe(source, "shadow"), 21, true, false, true);
  check(describe(source, "1", true), 10, true, true, true); check(describe(source, "shadow", true), 20, true, true, true); check(describe(source, "inherited", true), 30, true, show, true);
  same(describe(source, "inherited"), undefined);
}
