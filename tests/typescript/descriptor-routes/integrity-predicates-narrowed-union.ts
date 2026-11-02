/*---
description: "Integrity predicates on a narrowed union distinguish writable configurable and absent nonenumerable fields."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-record, ts-type-aliases, ts-unions, ts-null-undefined, ts-narrowing, ts-strings]
---*/
// A nullable Record narrows before preventExtensions; node derives sealed and frozen from actual writable and configurable flags, including an empty object.
type Scalar = number | undefined;
type Target = Record<string, Scalar>;
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: string): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function read(value: Target, key: string): Scalar { return value[key]; }
function write(value: Target, key: string, next: Scalar): void { value[key] = next; }
function remove(value: Target, key: string): boolean { return delete value[key]; }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }

function make(present: boolean, n: Scalar, writable: boolean, configurable: boolean): Target { const value: Target = {}; if (present) Object.defineProperty(value, "value", { value: n, writable, enumerable: false, configurable }); return value; }
function listed(value: Target): string[] { return Object.keys(value); }
function lockRoute(value: Target): Target { return Object.preventExtensions(value); }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
for (const n of [-0, NaN, undefined, 7]) for (const writable of [false, true]) for (const configurable of [false, true]) {
  const samples: { source: Target | null; present: boolean }[] = [{ source: null, present: false }, { source: make(false, n, writable, configurable), present: false }, { source: make(true, n, writable, configurable), present: true }];
  for (const sample of samples) {
    const source = sample.source; if (source === null) continue; const keys = sample.present ? ["value"] : []; let expected = sample.present ? n : undefined;
    assert.compareArray(state(source), [true, false, false]); same(lockRoute(source), source); assert.compareArray(state(source), [false, !sample.present || !configurable, !sample.present || !configurable && !writable]);
    assert.compareArray(names(source), keys); assert.compareArray(listed(source), []); if (sample.present) data(describe(source, "value"), n, writable, false, configurable); else same(describe(source, "value"), undefined);
    assert.throws(TypeError, () => write(source, "extra", 11)); same(read(source, "extra"), undefined); same(describe(source, "extra"), undefined); same(read(source, "value"), expected); assert.compareArray(names(source), keys);
    if (sample.present) {
      if (writable) { write(source, "value", 23); expected = 23; } else { assert.throws(TypeError, () => write(source, "value", 23)); }
      same(read(source, "value"), expected); data(describe(source, "value"), expected, writable, false, configurable); assert.compareArray(names(source), keys); assert.compareArray(listed(source), []);
    }
    if (!sample.present || configurable) { same(remove(source, "value"), true); same(read(source, "value"), undefined); same(describe(source, "value"), undefined); assert.compareArray(names(source), []); assert.compareArray(state(source), [false, true, true]); }
    else { assert.throws(TypeError, () => remove(source, "value")); same(read(source, "value"), expected); data(describe(source, "value"), expected, writable, false, false); assert.compareArray(names(source), keys); }
  }
}
