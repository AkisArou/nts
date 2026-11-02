/*---
description: Plain flag-record control for A narrowed union permits SameValue redefinition of locked data and rejects distinct zero signs or other changed values.
features: [ts-descriptor-route-defining, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-interfaces, ts-generics, ts-optional-properties, ts-null-undefined, ts-record, ts-spread, ts-type-aliases, ts-unions, ts-narrowing, ts-tuples, ts-strings]
---*/
// A union field narrows to a data target before redefinition; node accepts the same NaN or zero sign, rejects changed values and keeps the nonconfigurable property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Change { value?: number; writable?: boolean; enumerable?: boolean; configurable?: boolean; }

interface Cell { value: number | undefined; writable: boolean; enumerable: boolean; configurable: boolean; }
interface Target { cells: Record<string, Cell>; }
function makeTarget(value: number | undefined): Target { return { cells: { value: { value, writable: false, enumerable: false, configurable: false } } }; }
function describe(target: Target): PropertyDescriptor { return { ...target.cells.value }; }
function read(target: Target): number | undefined { return target.cells.value.value; }
function names(target: Target): string[] { return Object.keys(target.cells); }
function keys(target: Target): string[] { return names(target).filter(key => target.cells[key].enumerable); }

function redefine<T extends Target>(target: T, change: Change): T {
  const d = target.cells.value;
  if (!d.configurable && (change.configurable === true || change.enumerable !== undefined && change.enumerable !== d.enumerable || !d.writable && (change.writable === true || "value" in change && !Object.is(change.value, d.value)))) throw new TypeError("redefine");
  if ("value" in change) d.value = change.value; if (change.writable !== undefined) d.writable = change.writable;
  if (change.enumerable !== undefined) d.enumerable = change.enumerable; if (change.configurable !== undefined) d.configurable = change.configurable; return target;
}

function remove(target: Target): boolean { if (!target.cells.value.configurable) throw new TypeError("delete"); return delete target.cells.value; }
type Route = { kind: "locked"; target: Target } | { kind: "skip"; text: string };
const samples: [number, number][] = [[-0, 0], [0, -0], [NaN, 1], [1, NaN]];
for (const [input, changed] of samples) for (const skip of [false, true]) {
  const route: Route = skip ? { kind: "skip", text: "untouched" } : { kind: "locked", target: makeTarget(input) };
  if (route.kind === "skip") { same(route.text, "untouched"); continue; }
  const target = route.target; check(describe(target), input, false, false, false);
  same(redefine(target, { value: input }), target); redefine(target, {}); redefine(target, { writable: false, configurable: false }); same(read(target), input);
  assert.throws(TypeError, () => redefine(target, { value: changed })); same(read(target), input); check(describe(target), input, false, false, false);
  assert.throws(TypeError, () => remove(target)); same(read(target), input); check(describe(target), input, false, false, false);
  assert.compareArray(names(target), ["value"]);
}
