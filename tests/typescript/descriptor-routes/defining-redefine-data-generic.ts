/*---
description: A constrained generic data redefinition preserves omitted flags and enforces the transition to a locked property.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-generics, ts-optional-properties, ts-null-undefined, ts-record, ts-spread]
---*/
// A generic interface parameter carries existing data through allowed and forbidden redefinitions; node retains omitted attributes and rejects reopening a locked property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Change { value?: number; writable?: boolean; enumerable?: boolean; configurable?: boolean; }

interface Target { value?: number; }
function makeTarget(value: number | undefined): Target { return { value }; }
function redefine<T extends Target>(target: T, change: Change): T { return Object.defineProperty(target, "value", change); }
function describe(target: Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, "value"); }
function read(target: Target): number | undefined { return target.value; }
function names(target: Target): string[] { return Object.getOwnPropertyNames(target); }
function keys(target: Target): string[] { return Object.keys(target); }
for (const input of [undefined, -0, NaN, 17]) {
  const target: Target = makeTarget(input); check(describe(target), input, true, true, true);
  same(redefine(target, { value: input }), target); check(describe(target), input, true, true, true);
  redefine(target, { enumerable: false }); check(describe(target), input, true, false, true); same(read(target), input);
  redefine(target, { configurable: false }); check(describe(target), input, true, false, false);
  redefine(target, { value: 23 }); check(describe(target), 23, true, false, false); same(read(target), 23);
  redefine(target, { writable: false }); check(describe(target), 23, false, false, false); redefine(target, {}); redefine(target, { value: 23 });
  const forbidden: Change[] = [{ value: input }, { writable: true }, { enumerable: true }, { configurable: true }];
  for (const change of forbidden) { assert.throws(TypeError, () => redefine(target, change)); same(read(target), 23); check(describe(target), 23, false, false, false); }
  assert.compareArray(names(target), ["value"]); assert.compareArray(keys(target), []);
}
