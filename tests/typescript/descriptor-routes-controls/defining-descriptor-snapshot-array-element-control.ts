/*---
description: Plain flag-record control for Descriptors read through an array element are independent snapshots until explicitly reapplied.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-record, ts-spread, ts-expressions]
---*/
// Interface objects in a typed array reach both descriptor readers; node returns detached metadata records and changes the object only when that metadata is defined back.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number | undefined; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { cells: Record<string, Cell>; }
function makeTarget(value: number | undefined): Target { return { cells: { value: { value, writable: true, enumerable: true, configurable: true } } }; }
function describe(target: Target): PropertyDescriptor { return { ...target.cells.value }; }
function read(target: Target): number | undefined { return target.cells.value.value; }
function names(target: Target): string[] { return Object.keys(target.cells); }
function keys(target: Target): string[] { return names(target).filter(key => target.cells[key].enumerable); }

function describeAll(target: Target): { value?: PropertyDescriptor } { return { value: describe(target) }; }
function apply(target: Target, d: PropertyDescriptor): Target { const value: unknown = d.value; if (typeof value !== "number" && value !== undefined) throw new TypeError("value"); const old = target.cells.value; target.cells.value = { value, writable: d.writable ?? old.writable, enumerable: d.enumerable ?? old.enumerable, configurable: d.configurable ?? old.configurable }; return target; }
function write(target: Target, value: number): void { if (!target.cells.value.writable) throw new TypeError("write"); target.cells.value.value = value; }
for (const input of [-0, NaN, 17]) {
  const targets: Target[] = [makeTarget(input), makeTarget(undefined)];
  for (const target of targets) {
    const original = read(target), single = describe(target), all = describeAll(target);
    if (single === undefined || all.value === undefined) throw new Error("snapshot");
    assert.compareArray(Object.keys(all), ["value"]); check(single, original, true, true, true); check(all.value, original, true, true, true);
    same(Object.is(single, all.value), false); single.value = 23; single.writable = false; single.enumerable = false; single.configurable = false;
    all.value.value = 31; all.value.writable = false; same(read(target), original); check(describe(target), original, true, true, true);
    same(apply(target, single), target); same(read(target), 23); check(describe(target), 23, false, false, false); assert.compareArray(names(target), ["value"]);
    assert.throws(TypeError, () => write(target, 31)); same(read(target), 23); check(describe(target), 23, false, false, false);
  }
}
