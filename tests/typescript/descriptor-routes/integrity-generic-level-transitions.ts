/*---
description: "One generic route escalates an object through nonextensible sealed and frozen states with exact flags."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-generics, ts-type-aliases, ts-unions, ts-strings]
---*/
// A generic interface parameter survives preventExtensions then seal then freeze; node changes only the flags each stronger level requires.
type Scalar = number | undefined;
interface Target { value?: Scalar; extra?: Scalar; }
function names(value: Target): string[] { return Object.getOwnPropertyNames(value); }
function describe(value: Target, key: keyof Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(value, key); }
function read(value: Target, key: keyof Target): Scalar { return value[key]; }
function write(value: Target, key: keyof Target, next: Scalar): void { value[key] = next; }
function state(value: Target): boolean[] { return [Object.isExtensible(value), Object.isSealed(value), Object.isFrozen(value)]; }
function make(present: boolean, n: Scalar): Target { return present ? { value: n } : {}; }

type Level = "prevent" | "seal" | "freeze";
function harden<T extends Target>(value: T, level: Level): T { if (level === "prevent") Object.preventExtensions(value); else if (level === "seal") Object.seal(value); else Object.freeze(value); return value; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function data(d: PropertyDescriptor | undefined, value: unknown, writable: boolean, enumerable: boolean, configurable: boolean): void {
  if (d === undefined) throw new Error("descriptor"); same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, undefined); same(d.set, undefined);
  assert.compareArray(Object.keys(d), ["value", "writable", "enumerable", "configurable"]);
}
const levels: Level[] = ["prevent", "seal", "freeze"];
for (const n of [-0, NaN, undefined, 7]) for (const present of [false, true]) {
  const source: Target = make(present, n), keys = present ? ["value"] : []; let expected = present ? n : undefined;
  assert.compareArray(state(source), [true, false, false]);
  for (const level of levels) {
    same(harden(source, level), source); assert.compareArray(state(source), [false, !present || level !== "prevent", !present || level === "freeze"]);
    assert.compareArray(names(source), keys); if (present) data(describe(source, "value"), expected, level !== "freeze", true, level === "prevent");
    assert.throws(TypeError, () => write(source, "extra", 11)); same(read(source, "extra"), undefined); same(read(source, "value"), expected); assert.compareArray(names(source), keys);
    if (present && level !== "freeze") { expected = level === "prevent" ? 23 : -0; write(source, "value", expected); same(read(source, "value"), expected); }
    if (present && level === "freeze") { assert.throws(TypeError, () => write(source, "value", expected)); same(read(source, "value"), expected); data(describe(source, "value"), expected, false, true, false); }
  }
}
