/*---
description: "A constructor array preserves each nested super return boundary before the next class defines its own fields."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-typeof-type, ts-instanceof]
---*/
// Super calls cross a typed constructor array through Middle and Derived; node defines each field after its base returns, before that class body, with the final constructor as new.target.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
class Base {
  value: unknown;
  constructor(value: unknown) { this.value = value; log.push("base:return", this, new.target, value, Object.hasOwn(this, "first"), Object.hasOwn(this, "second")); }
}
function field(receiver: Base, key: string): unknown { log.push(key + ":field", receiver, Object.hasOwn(receiver, "first"), Object.hasOwn(receiver, "second")); return receiver.value; }
class Middle extends Base {
  first: unknown = field(this, "first");
  constructor(value: unknown) { super(value); log.push("middle:body", this, Object.hasOwn(this, "first"), Object.hasOwn(this, "second")); }
}
class Derived extends Middle {
  second: unknown = field(this, "second");
  constructor(value: unknown) { super(value); log.push("derived:body", this, Object.hasOwn(this, "first"), Object.hasOwn(this, "second")); }
}
class Further extends Derived {}
function make(Type: typeof Derived, value: unknown): Derived { return new Type(value); }
const types: (typeof Derived)[] = [Derived, Further], token = { id: 8 };
const values: unknown[] = [-0, NaN, 8n, "", null, undefined, token];
for (const Type of types) for (const value of values) {
  log.length = 0; const result = make(Type, value);
  same(result.value, value); same(result.first, value); same(result.second, value);
  same(Object.getPrototypeOf(result), Type.prototype); same(result instanceof Middle, true);
  same(Object.hasOwn(Middle.prototype, "first"), false); same(Object.hasOwn(Derived.prototype, "second"), false);
  exact(Object.keys(result), ["value", "first", "second"]);
  exact(log, ["base:return", result, Type, value, false, false, "first:field", result, false, false,
    "middle:body", result, true, false, "second:field", result, true, false, "derived:body", result, true, true]);
}
