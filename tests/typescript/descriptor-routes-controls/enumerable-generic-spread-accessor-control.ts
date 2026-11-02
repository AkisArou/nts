/*---
description: Explicit attribute-record control for A generic spread reads only enumerable defined accessors and creates writable ordinary data.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-record, ts-interfaces, ts-generics, ts-spread, ts-this-parameter, ts-function-types, ts-optional-properties]
---*/
// A generic number Record carries a defined getter and hidden storage; node reads the getter only when enumerable and copies values into ordinary writable fields.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value?: number; writable?: boolean; get?: (this: Table) => number; set?: undefined; enumerable: boolean; configurable: boolean; }
type Table = Record<string, Cell>;
const calls: unknown[] = [];
function reader(this: Table): number { calls.push(this); const value = this.raw.value; if (value === undefined) throw new Error("raw"); return value; }
function make(value: number, show: boolean): Table { return { raw: { value, writable: true, enumerable: false, configurable: true }, "2": { get: reader, set: undefined, enumerable: show, configurable: true }, tail: { value: 8, writable: false, enumerable: true, configurable: false } }; }
function spread<T extends Table>(source: T): Record<string, number> { const copy: Record<string, number> = {}; for (const key of Object.keys(source)) { const cell = source[key]; if (cell.enumerable) { const value = cell.get === undefined ? cell.value : cell.get.call(source); if (value === undefined) throw new Error("value"); copy[key] = value; } } return copy; }
function names(source: Table): string[] { return Object.keys(source); }
function describe(source: Table, key: string): PropertyDescriptor | undefined { const cell = source[key]; return cell === undefined ? undefined : { ...cell }; }
function describeCopy(source: Record<string, number>, key: string): PropertyDescriptor | undefined { return Object.hasOwn(source, key) ? { value: source[key], writable: true, enumerable: true, configurable: true } : undefined; }
function raw(source: Table): number | undefined { return source.raw.value; }
function tail(source: Table): number | undefined { return source.tail.value; }
for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const source: Table = make(initial, show); calls.length = 0;
  check(describe(source, "raw"), initial, true, false, true); check(describe(source, "2"), undefined, undefined, show, true, reader); check(describe(source, "tail"), 8, false, true, false);
  assert.compareArray(calls, []); const copy = spread(source); assert.compareArray(calls, show ? [source] : []);
  assert.compareArray(names(source), ["2", "raw", "tail"]); assert.compareArray(Object.keys(copy), show ? ["2", "tail"] : ["tail"]);
  same(Object.hasOwn(copy, "raw"), false); same(Object.hasOwn(copy, "2"), show); same(copy["2"], show ? initial : undefined); same(copy.tail, 8);
  if (show) check(describeCopy(copy, "2"), initial, true, true, true); else same(describeCopy(copy, "2"), undefined);
  check(describeCopy(copy, "tail"), 8, true, true, true); copy.tail = 21; same(copy.tail, 21); same(tail(source), 8); same(raw(source), initial); assert.compareArray(calls, show ? [source] : []);
}
