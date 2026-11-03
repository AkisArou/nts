/*---
description: "Fresh derived class expressions returned through a constructor interface preserve identity when calling super and initializing fields."
features: [ts-super-routes, ts-super-route-constructors, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-this, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-class-expression, ts-interfaces, ts-construct-signatures, ts-static]
---*/
// A super call crosses a typed constructor return containing fresh derived class expressions; node retains each expression identity/new.target and defines its field between the base return and body.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
class Base {
  value: unknown;
  constructor(value: unknown) { this.value = value; log.push("base", this, new.target, value, Object.hasOwn(this, "copy")); log.push("base:return", this); }
}
interface Product extends Base { copy: unknown; }
interface Builder { new(value: unknown): Product; prototype: Product; label: string; }
function selected(label: string): Builder {
  return class Local extends Base {
    static label: string = label;
    copy: unknown = (log.push("field", this, Local, Local.label, this.value), this.value);
    constructor(value: unknown) { super(value); log.push("body", this, Local, new.target, Local.label); }
  };
}
function make(Type: Builder, value: unknown): Product { return new Type(value); }
const first = selected("alpha"), second = selected("beta"), token = { id: 14 };
same(first === second, false); same(first.prototype === second.prototype, false); same(first.label, "alpha"); same(second.label, "beta");
const values: unknown[] = [-0, NaN, 14n, "", null, undefined, token];
for (const Type of [first, second]) for (const value of values) {
  log.length = 0; const result = make(Type, value);
  same(result.value, value); same(result.copy, value); same(result.constructor, Type);
  same(Object.getPrototypeOf(result), Type.prototype); same(Object.getPrototypeOf(Type.prototype), Base.prototype);
  same(Object.getPrototypeOf(Type), Base); same(Object.hasOwn(result, "copy"), true);
  same(Object.hasOwn(Base.prototype, "copy"), false); exact(Object.keys(result), ["value", "copy"]);
  exact(log, ["base", result, Type, value, false, "base:return", result,
    "field", result, Type, Type.label, value, "body", result, Type, Type, Type.label]);
}
