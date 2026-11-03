/*---
description: Explicit control — A static super assignment calls the base setter without creating a shadow or changing the base.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-accessors, ts-interfaces, ts-typeof-operator]
---*/
// Same typed route; Reflect.set(Base, "x", value, this) throws TypeError on false and otherwise returns the original assignment value.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static get x(): unknown { log.push("get", this, this.seed); return this.seed; }
  static set x(value: unknown) { log.push("set", this, value); this.seed = value; }
}
class Derived extends Base {
  static override seed: unknown = "derived";
  static write(value: unknown): unknown { log.push("write", this, value); if (!Reflect.set(Base, "x", value, this)) throw new TypeError(); return value; }
}
class Further extends Derived { static override seed: unknown = "further"; }
class Sibling extends Derived { static override seed: unknown = "sibling"; }
interface Writer { seed: unknown; write(value: unknown): unknown; }
function assign(receiver: Writer, value: unknown): unknown { return receiver.write(value); }
for (const receiver of [Derived, Further, Sibling]) for (const value of [-0, NaN, "text", { token: 13 }]) {
  log.length = 0; const result = assign(receiver, value);
  assert.sameValue(result, value); assert.sameValue(receiver.seed, value); assert.sameValue(typeof receiver.seed, typeof value);
  assert.sameValue(Object.hasOwn(receiver, "seed"), true); assert.sameValue(Object.hasOwn(receiver, "x"), false);
  assert.sameValue(Object.hasOwn(Base, "x"), true); assert.sameValue(Base.seed, "base"); assert.sameValue(Base.x, "base");
  assert.compareArray(log, ["write", receiver, value, "set", receiver, value, "get", Base, "base"]);
}
