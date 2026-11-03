/*---
description: Explicit control — A static field assignment calls a super setter before its result field is defined.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-typeof-type, ts-accessors, ts-typeof-operator]
---*/
// Same typed route; A typed helper calls Reflect.set(Parent, "x", value, this), throws TypeError on false and returns value before the field is defined.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static get x(): unknown { log.push("get", this, this.seed); return this.seed; }
  static set x(value: unknown) { log.push("set", this, value, this.seed, Object.hasOwn(this, "result")); this.seed = value; }
}
class Other extends Base { static override seed: unknown = "other"; }
function write(Parent: typeof Base, receiver: typeof Base, value: unknown): unknown { if (!Reflect.set(Parent, "x", value, receiver)) throw new TypeError(); return value; }
function build(Parent: typeof Base, value: unknown) {
  class Derived extends Parent {
    static override seed: unknown = "derived";
    static result: unknown = write(Parent, this, value);
    static after: boolean = Object.hasOwn(this, "result");
  }
  return Derived;
}
for (const Parent of [Base, Other]) for (const value of [-0, NaN, "text", { token: 15 }]) {
  const oldSeed = Parent.seed; log.length = 0; const receiver = build(Parent, value);
  assert.sameValue(receiver.result, value); assert.sameValue(typeof receiver.result, typeof value); assert.sameValue(receiver.seed, value);
  assert.sameValue(receiver.after, true); assert.sameValue(Object.hasOwn(receiver, "result"), true);
  assert.sameValue(Object.hasOwn(receiver, "seed"), true); assert.sameValue(Object.hasOwn(receiver, "x"), false);
  assert.sameValue(Parent.seed, oldSeed); assert.sameValue(Base.seed, "base"); assert.sameValue(Base.x, "base");
  assert.compareArray(log, ["set", receiver, value, "derived", false, "get", Base, "base"]);
}
