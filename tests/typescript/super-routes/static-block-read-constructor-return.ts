/*---
description: A typed factory return retains the constructor observed by a static block super read.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-typeof-type, ts-accessors, ts-interfaces, ts-class-static-block, ts-typeof-operator]
---*/
// super.x in a static block via a declared factory return; node reads on the new constructor between the before and after fields.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static get x(): unknown { log.push("get", this, this.seed); return this.seed; }
}
class Other extends Base { static override seed: unknown = "other"; }
interface Product { seed: unknown; observed: unknown; after: unknown; }
function mark(label: string, receiver: typeof Base, value: unknown): unknown { log.push(label, receiver, value); return value; }
function build(Parent: typeof Base, value: unknown): Product {
  class Derived extends Parent {
    static override seed: unknown = mark("before", this, value);
    static observed: unknown;
    static { const result: unknown = super.x; log.push("block", this, result); this.observed = result; }
    static after: unknown = mark("after", this, value);
  }
  return Derived;
}
for (const Parent of [Base, Other]) for (const value of [-0, NaN, "text", { token: 16 }]) {
  const oldSeed = Parent.seed; log.length = 0; const receiver: Product = build(Parent, value);
  assert.sameValue(receiver.observed, value); assert.sameValue(typeof receiver.observed, typeof value); assert.sameValue(receiver.after, value);
  assert.sameValue(Object.hasOwn(receiver, "observed"), true); assert.sameValue(Object.getPrototypeOf(receiver), Parent);
  assert.sameValue(Parent.seed, oldSeed);
  assert.compareArray(log, ["before", receiver, value, "get", receiver, value, "block", receiver, value, "after", receiver, value]);
}
