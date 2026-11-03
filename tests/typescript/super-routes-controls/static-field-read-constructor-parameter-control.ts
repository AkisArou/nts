/*---
description: Explicit control — A static field reads super after its receiver seed is defined and before following fields.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-typeof-type, ts-accessors, ts-typeof-operator]
---*/
// Same typed route; The field uses Reflect.get(Parent, "x", this) at the same initializer position.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static get x(): unknown { log.push("get", this, this.seed, Object.hasOwn(this, "seed"), Object.hasOwn(this, "observed")); return this.seed; }
}
class Other extends Base { static override seed: unknown = "other"; }
function mark(label: string, receiver: typeof Base, value: unknown): unknown { log.push(label, receiver, value, Object.hasOwn(receiver, "observed")); return value; }
function build(Parent: typeof Base, value: unknown) {
  class Derived extends Parent {
    static override seed: unknown = mark("seed", this, value);
    static observed: unknown = Reflect.get(Parent, "x", this);
    static after: unknown = mark("after", this, value);
  }
  return Derived;
}
for (const Parent of [Base, Other]) for (const value of [-0, NaN, "text", { token: 14 }]) {
  const oldSeed = Parent.seed; log.length = 0; const receiver = build(Parent, value);
  assert.sameValue(receiver.observed, value); assert.sameValue(typeof receiver.observed, typeof value); assert.sameValue(receiver.after, value);
  assert.sameValue(Object.hasOwn(receiver, "seed"), true); assert.sameValue(Object.hasOwn(receiver, "observed"), true);
  assert.sameValue(Parent.seed, oldSeed); assert.sameValue(Object.getPrototypeOf(receiver), Parent);
  assert.compareArray(log, ["seed", receiver, value, false, "get", receiver, value, true, false, "after", receiver, value, true]);
}
