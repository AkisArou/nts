/*---
description: "Explicit property-flag control: One generic route escalates an object through nonextensible sealed and frozen states with exact flags."
features: [ts-descriptor-route-integrity, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-generics, ts-type-aliases, ts-unions, ts-strings, ts-record]
---*/
// A generic interface parameter survives preventExtensions then seal then freeze; node changes only the flags each stronger level requires.
type Scalar = number | undefined;
interface Slot { value: Scalar; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { fields: Record<string, Slot>; extensible: boolean; }
function names(value: Target): string[] { return Object.keys(value.fields); }
function describe(value: Target, key: "value" | "extra"): PropertyDescriptor | undefined { const d = value.fields[key]; return d === undefined ? undefined : { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }; }
function read(value: Target, key: "value" | "extra"): Scalar { return value.fields[key]?.value; }
function write(value: Target, key: "value" | "extra", next: Scalar): void { const d = value.fields[key]; if (d === undefined) { if (!value.extensible) throw new TypeError(); value.fields[key] = { value: next, writable: true, enumerable: true, configurable: true }; } else { if (!d.writable) throw new TypeError(); d.value = next; } }
function state(value: Target): boolean[] { const cells = Object.values(value.fields); return [value.extensible, !value.extensible && cells.every(d => !d.configurable), !value.extensible && cells.every(d => !d.configurable && !d.writable)]; }
function make(present: boolean, n: Scalar): Target { return { fields: present ? { value: { value: n, writable: true, enumerable: true, configurable: true } } : {}, extensible: true }; }

type Level = "prevent" | "seal" | "freeze";
function harden<T extends Target>(value: T, level: Level): T { value.extensible = false; for (const key of names(value)) { if (level !== "prevent") value.fields[key].configurable = false; if (level === "freeze") value.fields[key].writable = false; } return value; }
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
