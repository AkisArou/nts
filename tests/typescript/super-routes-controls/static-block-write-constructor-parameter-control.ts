/*---
description: Explicit control — A static block super data write creates an own constructor property and preserves the selected base.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-typeof-type, ts-class-static-block, ts-typeof-operator]
---*/
// Same typed route; Reflect.set(Parent, "x", value, this) in the static block throws TypeError on false and otherwise makes the same receiver write.
const log: unknown[] = [];
class Base { static x: number = 7; }
class Middle extends Base { static override x: number = 19; }
function build(Parent: typeof Base, value: number) {
  class Derived extends Parent {
    static {
      log.push("before", this, Object.hasOwn(this, "x"));
      if (!Reflect.set(Parent, "x", value, this)) throw new TypeError();
      log.push("after", this, Object.hasOwn(this, "x"));
    }
  }
  return Derived;
}
for (const Parent of [Base, Middle]) for (const value of [-0, NaN, 41]) {
  const original = Parent.x; log.length = 0; const receiver = build(Parent, value);
  assert.sameValue(receiver.x, value); assert.sameValue(typeof receiver.x, "number");
  assert.sameValue(Object.hasOwn(receiver, "x"), true); assert.sameValue(Parent.x, original);
  assert.sameValue(Base.x, 7); assert.sameValue(Middle.x, 19); assert.sameValue(Object.getPrototypeOf(receiver), Parent);
  assert.compareArray(log, ["before", receiver, false, "after", receiver, true]);
}
