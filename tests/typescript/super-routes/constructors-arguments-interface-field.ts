/*---
description: "A constructor in an interface field orders argument effects, base construction and derived field initialization."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-interfaces, ts-construct-signatures, ts-instanceof]
---*/
// A super call crosses the Route constructor field; node runs both arguments, the base, the field initializer and the body in order, preserving this and new.target.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
function argument(label: string, value: unknown): unknown { log.push(label, value); return value; }
class Base {
  value: unknown; marker: unknown;
  constructor(value: unknown, marker: unknown) {
    log.push("base:enter", this, new.target, value, marker, Object.hasOwn(this, "ready"));
    this.value = value; this.marker = marker; log.push("base:return", this, Object.hasOwn(this, "ready"));
  }
}
class Derived extends Base {
  ready: unknown = (log.push("field", this, this.value, Object.hasOwn(this, "ready")), this.value);
  constructor(value: unknown, marker: unknown) {
    log.push("derived:enter"); super(argument("arg:first", value), argument("arg:second", marker));
    log.push("derived:body", this, this.ready);
  }
}
class Further extends Derived {}
interface Builder { new(value: unknown, marker: unknown): Derived; prototype: Derived; }
interface Route { Type: Builder; }
function make(route: Route, value: unknown, marker: unknown): Derived { return new route.Type(value, marker); }
const token = { id: 7 }, routes: Route[] = [{ Type: Derived }, { Type: Further }];
const values: unknown[] = [-0, NaN, 7n, "", null, undefined, token];
for (const route of routes) for (const value of values) {
  const marker = { value }; log.length = 0; const result = make(route, value, marker);
  same(result.value, value); same(result.marker, marker); same(result.ready, value);
  same(Object.getPrototypeOf(result), route.Type.prototype); same(result instanceof route.Type, true);
  same(Object.hasOwn(result, "ready"), true); same(Object.hasOwn(Derived.prototype, "ready"), false);
  exact(Object.keys(result), ["value", "marker", "ready"]);
  exact(log, ["derived:enter", "arg:first", value, "arg:second", marker,
    "base:enter", result, route.Type, value, marker, false, "base:return", result, false,
    "field", result, value, false, "derived:body", result, value]);
}
