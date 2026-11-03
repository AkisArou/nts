/*---
description: Explicit control — A static setter calls the base method with the constructor supplied by a typed parameter.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-accessors, ts-interfaces, ts-typeof-operator]
---*/
// Same typed route; The static setter calls Base.m.call(this, value); all destinations and full call logs remain identical.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static m(value: unknown): void { log.push("base-method", this, value); this.seed = value; }
}
class Derived extends Base {
  static override seed: unknown = "derived";
  static set result(value: unknown) { log.push("setter", this, value); Base.m.call(this, value); }
}
class Further extends Derived { static override seed: unknown = "further"; static override m(value: unknown): void { log.push("wrong-method", this, value); } }
class Sibling extends Further { static override seed: unknown = "sibling"; }
interface Sink { result: unknown; seed: unknown; }
function assign(receiver: Sink, value: unknown): void { receiver.result = value; }
for (const receiver of [Derived, Further, Sibling]) for (const value of [-0, NaN, "text", { token: 11 }]) {
  log.length = 0; assign(receiver, value);
  assert.sameValue(receiver.seed, value); assert.sameValue(typeof receiver.seed, typeof value);
  assert.sameValue(Object.hasOwn(receiver, "seed"), true); assert.sameValue(Object.hasOwn(receiver, "result"), receiver === Derived);
  assert.sameValue(Base.seed, "base"); assert.compareArray(log, ["setter", receiver, value, "base-method", receiver, value]);
}
