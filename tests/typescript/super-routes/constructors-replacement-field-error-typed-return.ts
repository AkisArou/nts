/*---
description: "A returned constructor encounters a nonconfigurable replacement-object field after its initializer and preserves only the earlier field."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-interfaces, ts-typeof-type, ts-declare-field, ts-errors, ts-arrow-functions, ts-narrowing]
---*/
// A super call uses a constructor from a typed return; node runs the base and two initializers, throws TypeError while defining the locked field, and skips the later field and body.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
interface Target { value: unknown; blocked: unknown; }
class Base {
  declare value: unknown;
  constructor(target: Target) { log.push("base", new.target, target, Object.hasOwn(target, "first")); log.push("base:return", target); return target; }
}
class Derived extends Base {
  first: unknown = (log.push("first:init", this, Object.hasOwn(this, "first")), this.value);
  blocked: unknown = (log.push("blocked:init", this, Object.hasOwn(this, "blocked")), this.value);
  after: unknown = (log.push("after:init", this), this.value);
  constructor(target: Target) { super(target); log.push("body", this); }
}
function selected(): typeof Derived { return Derived; }
function make(Type: typeof Derived, target: Target): Derived { return new Type(target); }
const token = { id: 11 }, values: unknown[] = [-0, NaN, 11n, "", null, undefined, token];
for (const value of values) {
  const target: Target = { value, blocked: "locked" }, Type = selected();
  Object.defineProperty(target, "blocked", { value: "locked", writable: true, enumerable: true, configurable: false });
  log.length = 0; assert.throws(TypeError, () => make(Type, target));
  same(target.value, value); same(target.blocked, "locked"); same(Object.getPrototypeOf(target), Object.prototype);
  same(Object.hasOwn(target, "first"), true); same(Object.hasOwn(target, "after"), false);
  if ("first" in target) same(target.first, value);
  exact(Object.keys(target), ["value", "blocked", "first"]);
  exact(log, ["base", Type, target, false, "base:return", target,
    "first:init", target, false, "blocked:init", target, true]);
}
