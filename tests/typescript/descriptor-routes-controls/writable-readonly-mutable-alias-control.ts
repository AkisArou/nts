/*---
description: Plain flag-record control for A readonly interface aliases a mutable interface while runtime descriptor changes independently govern writes.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-readonly, ts-record, ts-spread]
---*/
// A readonly interface value is assigned to a mutable interface alias; node permits writes until defineProperty makes the shared data property non-writable.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
interface ReadView { readonly cells: Record<string, Cell>; }
interface WriteView { cells: Record<string, Cell>; }
function makeTarget(value: number): ReadView { return { cells: { value: { value, writable: true, enumerable: true, configurable: true } } }; }
function write(target: WriteView, value: number): void { const d = target.cells.value; if (!d.writable) throw new TypeError("write"); d.value = value; }
function read(target: ReadView): number { return target.cells.value.value; }
function lock(target: ReadView): ReadView { target.cells.value.writable = false; return target; }
function describe(target: ReadView): PropertyDescriptor { return { ...target.cells.value }; }
function names(target: ReadView): string[] { return Object.keys(target.cells); }
for (const input of [-0, NaN, 17]) {
  const view: ReadView = makeTarget(input), alias: WriteView = view;
  same(alias, view); check(describe(view), input, true, true, true); assert.compareArray(names(view), ["value"]);
  write(alias, 23); same(read(view), 23); check(describe(view), 23, true, true, true);
  same(lock(view), view); check(describe(view), 23, false, true, true);
  assert.throws(TypeError, () => write(alias, input)); same(read(view), 23); check(describe(view), 23, false, true, true);
  assert.throws(TypeError, () => write(alias, 23)); same(read(view), 23); check(describe(view), 23, false, true, true); assert.compareArray(names(alias), ["value"]);
}
