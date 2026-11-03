/*---
description: "A field initializer reached through a generic constructor reads the home base getter with the new derived receiver."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-generics, ts-generic-constraints, ts-typeof-type, ts-accessors, ts-override]
---*/
// A field super getter read crosses a generic constructor parameter; node uses the Base getter with this, after before is defined and before copied/after exist, even for further overriding subclasses.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
class Base {
  value: unknown;
  constructor(value: unknown) { this.value = value; log.push("base", this, new.target, value); }
  get selected(): unknown { log.push("base:get", this, this.value, Object.hasOwn(this, "before"), Object.hasOwn(this, "copied"), Object.hasOwn(this, "after")); return this.value; }
}
class Derived extends Base {
  before: unknown = (log.push("before", this, Object.hasOwn(this, "before")), this.value);
  copied: unknown = super.selected;
  after: unknown = (log.push("after", this, this.copied, Object.hasOwn(this, "copied")), this.copied);
  constructor(value: unknown) { super(value); log.push("body", this, this.after); }
  override get selected(): unknown { log.push("derived:get", this); return "derived-override"; }
}
class Further extends Derived { override get selected(): unknown { log.push("further:get", this); return "further-override"; } }
class Sibling extends Derived { override get selected(): unknown { log.push("sibling:get", this); return "sibling-override"; } }
function make<T extends typeof Derived>(Type: T, value: unknown): Derived { return new Type(value); }
const token = { id: 9 }, values: unknown[] = [-0, NaN, 9n, "", null, undefined, token];
for (const Type of [Derived, Further, Sibling]) for (const value of values) {
  log.length = 0; const result = make(Type, value);
  same(result.before, value); same(result.copied, value); same(result.after, value);
  same(Object.getPrototypeOf(result), Type.prototype); same(Object.hasOwn(result, "selected"), false);
  same(Object.hasOwn(result, "copied"), true); same(Object.hasOwn(Base.prototype, "copied"), false);
  exact(Object.keys(result), ["value", "before", "copied", "after"]);
  exact(log, ["base", result, Type, value, "before", result, false,
    "base:get", result, value, true, false, false, "after", result, value, true, "body", result, value]);
}
