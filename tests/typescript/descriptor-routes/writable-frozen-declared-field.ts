/*---
description: An initially writable hidden property remains statically mutable through a holder field after freezing makes its runtime descriptor non-writable.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-class, ts-class-fields, ts-record, ts-spread]
---*/
// A mutable interface stored in a class field carries hidden writable data through freeze; node changes its writable and configurable flags and rejects changed and identical writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Target { value: number; }
class Holder { target: Target; constructor(value: number) { this.target = { value }; Object.defineProperty(this.target, "value", { enumerable: false }); } }
function lock(target: Target): Target { return Object.freeze(target); }
function frozen(target: Target): boolean { return Object.isFrozen(target); }
function write(target: Target, value: number): void { target.value = value; }
function read(target: Target): number { return target.value; }
function describe(target: Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, "value"); }
function names(target: Target): string[] { return Object.getOwnPropertyNames(target); }
function keys(target: Target): string[] { return Object.keys(target); }
for (const input of [-0, NaN, 17]) {
  const holder = new Holder(input), target: Target = holder.target; same(frozen(target), false); check(describe(target), input, true, false, true);
  assert.compareArray(names(target), ["value"]); assert.compareArray(keys(target), []); same(lock(target), target); same(frozen(target), true); check(describe(target), input, false, false, false);
  assert.throws(TypeError, () => write(holder.target, 23)); same(read(target), input); check(describe(target), input, false, false, false);
  assert.throws(TypeError, () => write(holder.target, input)); same(read(target), input); check(describe(target), input, false, false, false);
  same(frozen(target), true); assert.compareArray(names(target), ["value"]); assert.compareArray(keys(target), []);
}
