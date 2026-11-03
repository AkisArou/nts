/*---
description: Explicit control — A static super getter read keeps the constructor receiver through a constructor array.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-typeof-type, ts-accessors, ts-typeof-operator]
---*/
// Same typed route; Reflect.get(Base, "x", this) explicitly supplies the actual constructor as the getter receiver.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static get x(): unknown { log.push("base-get", this, this.seed); return this.seed; }
}
class Derived extends Base {
  static override seed: unknown = "derived";
  static read(): unknown { log.push("read", this); return Reflect.get(Base, "x", this); }
}
class Further extends Derived { static override seed: unknown = -0; static override get x(): unknown { log.push("wrong-get", this); return "wrong"; } }
class Sibling extends Further { static override seed: unknown = { token: 12 }; }
const constructors: (typeof Derived)[] = [Derived, Further, Sibling];
for (const receiver of constructors) {
  log.length = 0; const result = receiver.read();
  assert.sameValue(result, receiver.seed); assert.sameValue(typeof result, typeof receiver.seed);
  assert.compareArray(log, ["read", receiver, "base-get", receiver, receiver.seed]);
  assert.sameValue(Base.seed, "base"); assert.sameValue(Object.hasOwn(receiver, "seed"), true);
}
