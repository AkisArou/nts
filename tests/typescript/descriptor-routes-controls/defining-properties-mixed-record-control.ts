/*---
description: Plain flag-record control for A Record receives mixed data and accessor definitions and returns every descriptor in ordered keys.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-record, ts-interfaces, ts-type-aliases, ts-null-undefined, ts-strings, ts-expressions, ts-function-types, ts-optional-properties]
---*/
// A declared Record enters defineProperties and getOwnPropertyDescriptors; node orders numeric keys, preserves mixed flags and reads the accessor through its stored function.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value?: number; writable?: boolean; enumerable: boolean; configurable: boolean; read?: () => number; }
interface Target { cells: Record<string, Cell>; }
interface Definition { value?: number; writable?: boolean; enumerable?: boolean; configurable?: boolean; get?: () => number; }
function makeTarget(): Target { return { cells: {} }; }
function install(target: Target, definitions: Record<string, Definition>): Target {
  for (const key of Object.keys(definitions)) { const d = definitions[key]; target.cells[key] = d.get === undefined ? { value: d.value, writable: d.writable ?? false, enumerable: d.enumerable ?? false, configurable: d.configurable ?? false } : { read: d.get, enumerable: d.enumerable ?? false, configurable: d.configurable ?? false }; } return target;
}
function describe(target: Target): Record<string, PropertyDescriptor> { const result: Record<string, PropertyDescriptor> = {}; for (const key of Object.keys(target.cells)) { const d = target.cells[key]; result[key] = d.read === undefined ? { value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable } : { get: d.read, set: undefined, enumerable: d.enumerable, configurable: d.configurable }; } return result; }
function read(target: Target, key: string): number | undefined { const d = target.cells[key]; return d.read === undefined ? d.value : d.read.call(target); }
function write(target: Target, key: string, value: number): void { const d = target.cells[key]; if (!d.writable) throw new TypeError("write"); d.value = value; }
function names(target: Target): string[] { return Object.keys(target.cells); }
function keys(target: Target): string[] { return names(target).filter(key => target.cells[key].enumerable); }
for (const input of [-0, NaN, 0, 17]) {
  const target: Target = makeTarget(), getter = () => input;
  const definitions: Record<string, Definition> = { "10": { value: input, writable: true }, tail: { get: getter, enumerable: true }, "2": { value: undefined, enumerable: true, configurable: true } };
  same(install(target, definitions), target); const all = describe(target);
  assert.compareArray(Object.keys(all), ["2", "10", "tail"]); assert.compareArray(names(target), ["2", "10", "tail"]); assert.compareArray(keys(target), ["2", "tail"]);
  check(all["2"], undefined, false, true, true); check(all["10"], input, true, false, false); check(all.tail, undefined, undefined, true, false, getter, undefined);
  same(read(target, "2"), undefined); same(read(target, "10"), input); same(read(target, "tail"), input);
  write(target, "10", 23); same(read(target, "10"), 23); check(describe(target)["10"], 23, true, false, false);
  assert.throws(TypeError, () => write(target, "tail", 23)); same(read(target, "tail"), input); check(describe(target).tail, undefined, undefined, true, false, getter, undefined);
}
