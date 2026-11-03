/*---
description: "Control for constructors-second-super-constructor-field; A constructor in an interface field runs the base a second time before the repeated super call throws ReferenceError."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-interfaces, ts-construct-signatures, ts-declare-field, ts-instanceof, ts-errors, ts-arrow-functions, ts-narrowing]
---*/
// Repeated super calls cross the Route constructor field; node constructs two base receivers with the same new.target, initializes derived fields only on the first, then throws ReferenceError. The control constructs the base with the same new target and defines the derived fields explicitly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [], entered: Base[] = [];
function argument(value: unknown): unknown { log.push("second:argument", value); return value; }
class Base {
  value: unknown;
  constructor(value: unknown) { this.value = value; entered.push(this); log.push("base", this, new.target, value, Object.hasOwn(this, "field")); log.push("base:return", this); }
}
class Derived extends Base { declare field: unknown; }
class Further extends Derived {}
interface Builder { new(value: unknown, other: unknown): Derived; prototype: Derived; }
interface Route { Type: Builder; }
function make(route: Route, value: unknown, other: unknown): Derived {
  const first: Base = Reflect.construct(Base, [value], route.Type);
  Object.defineProperty(first, "field", { value: (log.push("field", first, first.value), first.value), writable: true, enumerable: true, configurable: true });
  if (!(first instanceof Derived)) throw new TypeError(); log.push("before:second", first, first.field);
  const second: Base = Reflect.construct(Base, [argument(other)], route.Type);
  throw new ReferenceError();
}
const token = { id: 12 }, values: unknown[] = [-0, NaN, 12n, "", null, undefined, token];
const routes: Route[] = [{ Type: Derived }, { Type: Further }];
for (const route of routes) for (const value of values) {
  const other = { value }; log.length = 0; entered.length = 0;
  assert.throws(ReferenceError, () => make(route, value, other)); same(entered.length, 2);
  const first = entered[0], second = entered[1]; same(first === second, false);
  same(first.value, value); same(second.value, other);
  same(Object.getPrototypeOf(first), route.Type.prototype); same(Object.getPrototypeOf(second), route.Type.prototype);
  same(Object.hasOwn(first, "field"), true); same(Object.hasOwn(second, "field"), false);
  if ("field" in first) same(first.field, value);
  exact(Object.keys(first), ["value", "field"]); exact(Object.keys(second), ["value"]);
  exact(log, ["base", first, route.Type, value, false, "base:return", first, "field", first, value,
    "before:second", first, value, "second:argument", other, "base", second, route.Type, other, false, "base:return", second]);
}
