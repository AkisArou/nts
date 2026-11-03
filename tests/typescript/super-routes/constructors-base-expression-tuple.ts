/*---
description: "A tuple-held constructor invokes a named base class expression with the final new target before derived field initialization."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-class-expression, ts-typeof-type, ts-tuples, ts-type-aliases, ts-instanceof]
---*/
// A super call crosses a constructor tuple whose base is a named class expression; node preserves the expression self binding, final new.target, receiver and field-after-base order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
const Base = class Parent {
  value: unknown;
  constructor(value: unknown) { this.value = value; log.push("base", Parent, new.target, this, value, Object.hasOwn(this, "copy")); log.push("base:return", this); }
};
class Derived extends Base {
  copy: unknown = (log.push("field", this, this.value), this.value);
  constructor(value: unknown) { super(value); log.push("body", this, this.copy); }
}
class Further extends Derived {}
type Route = [typeof Derived];
function make(route: Route, value: unknown): Derived { return new route[0](value); }
const routes: Route[] = [[Derived], [Further]], token = { id: 13 };
const values: unknown[] = [-0, NaN, 13n, "", null, undefined, token];
for (const route of routes) for (const value of values) {
  log.length = 0; const result = make(route, value);
  same(result.value, value); same(result.copy, value); same(Base.name, "Parent");
  same(Object.getPrototypeOf(result), route[0].prototype); same(result instanceof Base, true);
  same(Object.getPrototypeOf(Derived.prototype), Base.prototype); same(Object.hasOwn(result, "copy"), true);
  same(Object.hasOwn(Base.prototype, "copy"), false); exact(Object.keys(result), ["value", "copy"]);
  exact(log, ["base", Base, route[0], result, value, false, "base:return", result, "field", result, value, "body", result, value]);
}
