/*---
description: A narrowed union permits SameValue redefinition of locked data and rejects distinct zero signs or other changed values.
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

interface Target { value?: number; }
function makeTarget(value: number): Target { return Object.defineProperty({}, "value", { value }); }
function redefine(target: Target, change: Change): Target { return Object.defineProperty(target, "value", change); }
function describe(target: Target): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(target, "value"); }
function read(target: Target): number | undefined { return target.value; }
function remove(target: Target): boolean { return delete target.value; }
function names(target: Target): string[] { return Object.getOwnPropertyNames(target); }
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
