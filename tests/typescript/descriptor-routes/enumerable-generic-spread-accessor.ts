/*---
description: A generic spread reads only enumerable defined accessors and creates writable ordinary data.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-record, ts-interfaces, ts-generics, ts-spread, ts-this-parameter, ts-function-types, ts-optional-properties]
---*/
// A generic number Record carries a defined getter and hidden storage; node reads the getter only when enumerable and copies values into ordinary writable fields.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
type Table = Record<string, number>;
const calls: unknown[] = [];
function reader(this: Table): number { calls.push(this); return this.raw; }
function make(value: number, show: boolean): Table { const source: Table = { raw: value }; Object.defineProperty(source, "raw", { enumerable: false }); Object.defineProperty(source, "2", { get: reader, enumerable: show, configurable: true }); Object.defineProperty(source, "tail", { value: 8, enumerable: true }); return source; }
function spread<T extends Table>(source: T): Record<string, number> { return { ...source }; }
function names(source: Table): string[] { return Object.getOwnPropertyNames(source); }
function describe(source: Table, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(source, key); }
function describeCopy(source: Record<string, number>, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(source, key); }
function raw(source: Table): number { return source.raw; }
function tail(source: Table): number { return source.tail; }
for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const source: Table = make(initial, show); calls.length = 0;
  check(describe(source, "raw"), initial, true, false, true); check(describe(source, "2"), undefined, undefined, show, true, reader); check(describe(source, "tail"), 8, false, true, false);
  assert.compareArray(calls, []); const copy = spread(source); assert.compareArray(calls, show ? [source] : []);
  assert.compareArray(names(source), ["2", "raw", "tail"]); assert.compareArray(Object.keys(copy), show ? ["2", "tail"] : ["tail"]);
  same(Object.hasOwn(copy, "raw"), false); same(Object.hasOwn(copy, "2"), show); same(copy["2"], show ? initial : undefined); same(copy.tail, 8);
  if (show) check(describeCopy(copy, "2"), initial, true, true, true); else same(describeCopy(copy, "2"), undefined);
  check(describeCopy(copy, "tail"), 8, true, true, true); copy.tail = 21; same(copy.tail, 21); same(tail(source), 8); same(raw(source), initial); assert.compareArray(calls, show ? [source] : []);
}
