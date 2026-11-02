/*---
description: Plain flag-record control for A descriptor batch reached through a Record validates an invalid mixed descriptor before creating any property.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-record, ts-interfaces, ts-type-aliases, ts-null-undefined, ts-strings, ts-spread, ts-expressions]
---*/
// A Record parameter receives valid or data-plus-getter descriptor batches; node applies valid batches in key order and throws TypeError before changing the target for an invalid descriptor.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Definition { value?: number; writable?: boolean; enumerable?: boolean; configurable?: boolean; get?: () => number; }
interface Cell { value: number | undefined; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { cells: Record<string, Cell>; }
function makeTarget(value: number): Target { return { cells: { seed: { value, writable: true, enumerable: true, configurable: true } } }; }
function install(target: Target, definitions: Record<string, Definition>): Target {
  for (const key of Object.keys(definitions)) { const d = definitions[key]; if ("get" in d && ("value" in d || "writable" in d)) throw new TypeError("mixed descriptor"); }
  for (const key of Object.keys(definitions)) { const d = definitions[key]; target.cells[key] = { value: d.value, writable: d.writable ?? false, enumerable: d.enumerable ?? false, configurable: d.configurable ?? false }; } return target;
}
function describe(target: Target, key: string): PropertyDescriptor | undefined { const d = target.cells[key]; return d === undefined ? undefined : { ...d }; }
function read(target: Target, key: string): number | undefined { const d = target.cells[key]; return d === undefined ? undefined : d.value; }
function names(target: Target): string[] { return Object.keys(target.cells); }
function keys(target: Target): string[] { return names(target).filter(key => target.cells[key].enumerable); }
for (const input of [-0, NaN, 17]) for (const invalid of [false, true]) {
  const target: Target = makeTarget(input), getter = () => input;
  const definitions: Record<string, Definition> = { "2": { value: input, writable: true, enumerable: true, configurable: true }, tail: invalid ? { value: input, get: getter } : { value: input } };
  if (invalid) { assert.throws(TypeError, () => install(target, definitions)); same(read(target, "seed"), input); assert.compareArray(names(target), ["seed"]); }
  else same(install(target, definitions), target);
  check(describe(target, "seed"), input, true, true, true); same(read(target, "seed"), input);
  assert.compareArray(names(target), invalid ? ["seed"] : ["2", "seed", "tail"]); assert.compareArray(keys(target), invalid ? ["seed"] : ["2", "seed"]);
  if (invalid) { same(describe(target, "2"), undefined); same(describe(target, "tail"), undefined); same(read(target, "2"), undefined); same(read(target, "tail"), undefined); }
  else { check(describe(target, "2"), input, true, true, true); check(describe(target, "tail"), input, false, false, false); same(read(target, "2"), input); same(read(target, "tail"), input); }
}
