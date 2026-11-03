/*---
description: "Control for constructors-base-expression-tuple; A tuple-held constructor invokes a named base class expression with the final new target before derived field initialization."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-class-expression, ts-typeof-type, ts-tuples, ts-type-aliases, ts-declare-field, ts-instanceof, ts-errors]
---*/
// A super call crosses a constructor tuple whose base is a named class expression; node preserves the expression self binding, final new.target, receiver and field-after-base order. The control constructs the base with the same new target and defines the derived fields explicitly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
const Base = class Parent {
  value: unknown;
  constructor(value: unknown) { this.value = value; log.push("base", Parent, new.target, this, value, Object.hasOwn(this, "copy")); log.push("base:return", this); }
};
class Derived extends Base { declare copy: unknown; }
class Further extends Derived {}
type Route = [typeof Derived];
function make(route: Route, value: unknown): Derived {
  const result: typeof Base.prototype = Reflect.construct(Base, [value], route[0]);
  Object.defineProperty(result, "copy", { value: (log.push("field", result, result.value), result.value), writable: true, enumerable: true, configurable: true });
  if (!(result instanceof Derived)) throw new TypeError(); log.push("body", result, result.copy); return result;
}
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
