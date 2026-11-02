/*---
description: A narrowed union routes a subclass receiver through a base-class accessor.
features: [ts-descriptor-route-accessors, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-declare-field, ts-inheritance, ts-unions, ts-narrowing, ts-interfaces, ts-optional-properties, ts-this-parameter, ts-function-types, ts-spread]
---*/
// A union selects base and derived instances whose base prototype has a defined accessor; node uses the actual instance as this and preserves derived fields.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
class BaseView { raw: number; declare slot?: number; constructor(raw: number) { this.raw = raw; } }
class DerivedView extends BaseView { marker = 17; }
type Routed = { kind: "base"; item: BaseView } | { kind: "derived"; item: DerivedView };
const calls: unknown[] = [];
function getter(this: BaseView): number { calls.push("get", this); return this.raw; }
function setter(this: BaseView, value: number): void { calls.push("set", this, value); this.raw = value; }
function make(initial: number, derived: boolean): Routed { Object.defineProperty(BaseView.prototype, "slot", { get: getter, set: setter, enumerable: false, configurable: true }); return derived ? { kind: "derived", item: new DerivedView(initial) } : { kind: "base", item: new BaseView(initial) }; }
function read(source: BaseView): number | undefined { return source.slot; }
function write(source: BaseView, value: number): void { source.slot = value; }
function names(source: BaseView): string[] { return Object.getOwnPropertyNames(source); }
function describe(source: BaseView): PropertyDescriptor | undefined { return Object.getOwnPropertyDescriptor(source, "slot"); }
function present(source: BaseView): boolean { return "slot" in source; }
for (const initial of [-0, NaN, 7]) for (const derived of [false, true]) {
  const route: Routed = make(initial, derived); calls.length = 0;
  if (route.kind === "derived") same(route.item.marker, 17);
  check(describe(BaseView.prototype), undefined, undefined, false, true, getter, setter); same(describe(route.item), undefined); same(present(route.item), true); assert.compareArray(calls, []);
  assert.compareArray(names(route.item), derived ? ["raw", "marker"] : ["raw"]); same(read(route.item), initial); write(route.item, 37); same(route.item.raw, 37); same(read(route.item), 37);
  assert.compareArray(calls, ["get", route.item, "set", route.item, 37, "get", route.item]); same(describe(route.item), undefined);
  if (route.kind === "derived") same(route.item.marker, 17);
  check(describe(BaseView.prototype), undefined, undefined, false, true, getter, setter);
}
