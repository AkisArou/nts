/*---
description: "Control for constructors-replacement-interface-target; A returned interface target receives the derived public field as an own data property without invoking its existing accessor."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-interfaces, ts-accessors, ts-this-parameter, ts-declare-field, ts-instanceof, ts-errors, ts-narrowing]
---*/
// Super returns a Target interface parameter; node uses that exact plain object as this, replaces its configurable accessor with the derived field, and leaves the allocated derived object unstamped. The control constructs the base with the same new target and defines the derived fields explicitly.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [], allocated: Base[] = [];
interface Target { value: unknown; copied: unknown; }
class Base {
  declare value: unknown;
  constructor(target: Target) { allocated.push(this); log.push("base", this, new.target, target, Object.hasOwn(this, "copied"), Object.hasOwn(target, "copied")); log.push("base:return", target); return target; }
}
class Derived extends Base { declare copied: unknown; }
function make(target: Target): Derived {
  const result: Base = Reflect.construct(Base, [target], Derived);
  const copied = (log.push("field", result, result.value, Object.hasOwn(result, "copied")), result.value);
  Object.defineProperty(result, "copied", { value: copied, writable: true, enumerable: true, configurable: true });
  if (!("copied" in result)) throw new TypeError();
  log.push("body", result, result.copied); return result;
}
const token = { id: 10 }, values: unknown[] = [-0, NaN, 10n, "", null, undefined, token];
for (const value of values) {
  const target: Target = { value, copied: "old" }, next = { value };
  Object.defineProperty(target, "copied", {
    get(this: Target): unknown { log.push("old:get", this); return "old"; },
    set(this: Target, input: unknown) { log.push("old:set", this, input); }, configurable: true, enumerable: false
  });
  log.length = 0; allocated.length = 0; const result = make(target);
  same(result, target); same(result.value, value); same(result.copied, value); same(result instanceof Derived, false);
  same(Object.getPrototypeOf(result), Object.prototype); same(allocated.length, 1);
  same(allocated[0] === result, false); same(Object.getPrototypeOf(allocated[0]), Derived.prototype);
  same(Object.hasOwn(allocated[0], "copied"), false); same(Object.hasOwn(result, "copied"), true);
  exact(Object.keys(result), ["value", "copied"]); result.copied = next; same(target.copied, next);
  exact(log, ["base", allocated[0], Derived, target, false, true, "base:return", target,
    "field", target, value, true, "body", target, value]);
}
