/*---
description: A constrained generic reaches an override whose super call ignores an own method shadow.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-generics, ts-generic-constraints, ts-this-parameter, ts-typeof-operator]
---*/
// super.run(value) through a generic receiver; node skips an own run shadow while the base hook still dispatches on this.
const log: unknown[] = [];
class Base {
  seed: unknown = "base";
  hook(): void { log.push("hook", this, this.seed); }
  run(this: Base, value: unknown): unknown { log.push("base", this, value); this.hook(); return value; }
}
class Derived extends Base {
  override seed: unknown = "derived";
  override hook(): void { log.push("derived-hook", this, this.seed); }
  override run(this: Base, value: unknown): unknown { log.push("derived", this, value); return super.run(value); }
}
class Further extends Derived { override seed: unknown = "further"; }
class Sibling extends Base { override seed: unknown = "sibling"; override hook(): void { log.push("sibling-hook", this, this.seed); } }
function invoke<T extends Base>(receiver: T, value: unknown): unknown { return Derived.prototype.run.call(receiver, value); }
const shadow = function(this: Base, value: unknown): unknown { log.push("own-shadow", this, value); return "wrong"; };
for (const receiver of [new Derived(), new Further(), new Sibling()]) {
  receiver.run = shadow;
  for (const value of [-0, NaN, "text", { token: 3 }]) {
    log.length = 0; const result = invoke(receiver, value);
    assert.sameValue(result, value); assert.sameValue(typeof result, typeof value);
    assert.compareArray(log, ["derived", receiver, value, "base", receiver, value,
      receiver.seed === "sibling" ? "sibling-hook" : "derived-hook", receiver, receiver.seed]);
    assert.sameValue(Object.hasOwn(receiver, "run"), true); assert.sameValue(receiver.run, shadow);
  }
}
