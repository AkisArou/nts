/*---
description: A static getter calls super with the constructor carried by an interface field.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-accessors, ts-interfaces, ts-typeof-operator]
---*/
// super.m(this.seed) in a static getter via an interface field; node returns that constructor seed and records it as the method receiver.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static m(value: unknown): unknown { log.push("base-method", this, value, this.seed); return value; }
}
class Derived extends Base {
  static override seed: unknown = "derived";
  static get result(): unknown { log.push("getter", this); return super.m(this.seed); }
}
class Further extends Derived {
  static override seed: unknown = -0;
  static override m(value: unknown): unknown { log.push("wrong-method", this, value); return "wrong"; }
}
class Sibling extends Further { static override seed: unknown = { token: 10 }; }
interface Source { readonly result: unknown; seed: unknown; }
interface Holder { source: Source; }
for (const receiver of [Derived, Further, Sibling]) {
  const holder: Holder = { source: receiver }; log.length = 0;
  const result = holder.source.result;
  assert.sameValue(result, receiver.seed); assert.sameValue(typeof result, typeof receiver.seed);
  assert.compareArray(log, ["getter", receiver, "base-method", receiver, receiver.seed, receiver.seed]);
  assert.sameValue(holder.source, receiver); assert.sameValue(Base.seed, "base");
}
