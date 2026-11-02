/*---
description: Plain flag-record control for An initially writable hidden property remains statically mutable through a holder field after freezing makes its runtime descriptor non-writable.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-class, ts-class-fields, ts-record, ts-spread]
---*/
// A mutable interface stored in a class field carries hidden writable data through freeze; node changes its writable and configurable flags and rejects changed and identical writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { cells: Record<string, Cell>; extensible: boolean; }
class Holder { target: Target; constructor(value: number) { this.target = { cells: { value: { value, writable: true, enumerable: false, configurable: true } }, extensible: true }; } }
function lock(target: Target): Target { target.extensible = false; for (const key of Object.keys(target.cells)) { target.cells[key].writable = false; target.cells[key].configurable = false; } return target; }
function frozen(target: Target): boolean { return !target.extensible && Object.keys(target.cells).every(key => !target.cells[key].writable && !target.cells[key].configurable); }
function write(target: Target, value: number): void { const d = target.cells.value; if (!d.writable) throw new TypeError("write"); d.value = value; }
function read(target: Target): number { return target.cells.value.value; }
function describe(target: Target): PropertyDescriptor { return { ...target.cells.value }; }
function names(target: Target): string[] { return Object.keys(target.cells); }
function keys(target: Target): string[] { return names(target).filter(key => target.cells[key].enumerable); }
for (const input of [-0, NaN, 17]) {
  const holder = new Holder(input), target: Target = holder.target; same(frozen(target), false); check(describe(target), input, true, false, true);
  assert.compareArray(names(target), ["value"]); assert.compareArray(keys(target), []); same(lock(target), target); same(frozen(target), true); check(describe(target), input, false, false, false);
  assert.throws(TypeError, () => write(holder.target, 23)); same(read(target), input); check(describe(target), input, false, false, false);
  assert.throws(TypeError, () => write(holder.target, input)); same(read(target), input); check(describe(target), input, false, false, false);
  same(frozen(target), true); assert.compareArray(names(target), ["value"]); assert.compareArray(keys(target), []);
}
