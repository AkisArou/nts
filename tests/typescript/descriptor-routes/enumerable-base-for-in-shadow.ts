/*---
description: A base-class for-in route skips a nonenumerable own shadow and filters inherited descriptor flags.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-declare-field, ts-optional-properties, ts-record, ts-interfaces, ts-map-set, ts-spread, ts-arrow-functions]
---*/
// A child crosses a base-class parameter with integer and string properties; node skips hidden own data and does not reveal the same-named enumerable prototype property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
class Parent { declare "1"?: number; declare shadow?: number; declare inherited?: number; }
class Child extends Parent { "2": number; tail: number = 7; constructor(value: number) { super(); this["2"] = value; } }
function make(value: number, show: boolean): Child { Object.defineProperties(Parent.prototype, { "1": { value: 10, writable: true, enumerable: true, configurable: true }, shadow: { value: 20, writable: true, enumerable: true, configurable: true }, inherited: { value: 30, writable: true, enumerable: show, configurable: true } }); const source = new Child(value); Object.defineProperty(source, "shadow", { value: 21, writable: true, configurable: true }); return source; }
function walk(source: Parent): string[] { const result: string[] = []; for (const key in source) result.push(key); return result; }
function keys(source: Parent): string[] { return Object.keys(source); }
function names(source: Parent): string[] { return Object.getOwnPropertyNames(source); }
function read(source: Parent, key: "1" | "shadow" | "inherited"): number | undefined { return source[key]; }
function describe(source: Parent, key: string, inherited = false): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(inherited ? Parent.prototype : source, key); }
for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const source: Parent = make(initial, show);
  assert.compareArray(walk(source), show ? ["2", "tail", "1", "inherited"] : ["2", "tail", "1"]); assert.compareArray(keys(source), ["2", "tail"]); assert.compareArray(names(source), ["2", "tail", "shadow"]);
  same(read(source, "shadow"), 21); same(read(source, "1"), 10); same(read(source, "inherited"), 30);
  check(describe(source, "2"), initial, true, true, true); check(describe(source, "tail"), 7, true, true, true); check(describe(source, "shadow"), 21, true, false, true);
  check(describe(source, "1", true), 10, true, true, true); check(describe(source, "shadow", true), 20, true, true, true); check(describe(source, "inherited", true), 30, true, show, true);
  same(describe(source, "inherited"), undefined);
}
