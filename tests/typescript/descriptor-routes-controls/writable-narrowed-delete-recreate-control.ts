/*---
description: Plain flag-record control for A non-writable configurable property reached through a narrowed union can be deleted and recreated as ordinary writable data.
features: [ts-descriptor-route-writability, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-optional-properties, ts-null-undefined, ts-record, ts-spread, ts-type-aliases, ts-unions, ts-narrowing, ts-strings]
---*/
// A discriminated union narrows to optional interface data; node rejects its initial write, permits deletion and gives a later ordinary assignment fresh true attributes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { cells: Record<string, Cell>; }
function makeTarget(value: number): Target { return { cells: { value: { value, writable: false, enumerable: false, configurable: true } } }; }
function write(target: Target, value: number): void { const d = target.cells.value; if (d !== undefined && !d.writable) throw new TypeError("write"); if (d === undefined) target.cells.value = { value, writable: true, enumerable: true, configurable: true }; else d.value = value; }
function read(target: Target): number | undefined { const d = target.cells.value; return d === undefined ? undefined : d.value; }
function remove(target: Target): boolean { const d = target.cells.value; if (d !== undefined && !d.configurable) throw new TypeError("delete"); return delete target.cells.value; }
function describe(target: Target): PropertyDescriptor | undefined { const d = target.cells.value; return d === undefined ? undefined : { ...d }; }
function names(target: Target): string[] { return Object.keys(target.cells); }
function has(target: Target): boolean { return "value" in target.cells; }
type Route = { kind: "data"; target: Target } | { kind: "skip"; text: string };
for (const input of [-0, NaN, 17]) for (const skip of [false, true]) {
  const route: Route = skip ? { kind: "skip", text: "untouched" } : { kind: "data", target: makeTarget(input) };
  if (route.kind === "skip") { same(route.text, "untouched"); continue; }
  const target = route.target; check(describe(target), input, false, false, true); same(has(target), true); assert.compareArray(names(target), ["value"]);
  assert.throws(TypeError, () => write(target, 23)); same(read(target), input); check(describe(target), input, false, false, true);
  same(remove(target), true); same(read(target), undefined); same(describe(target), undefined); same(has(target), false); assert.compareArray(names(target), []);
  write(target, 23); same(read(target), 23); same(has(target), true); check(describe(target), 23, true, true, true); assert.compareArray(names(target), ["value"]);
}
