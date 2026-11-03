/*---
description: A constructor array preserves the current static base method and the actual constructor receiver.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-typeof-type, ts-this-parameter, ts-typeof-operator]
---*/
// Static super.run(value) through typeof Base array elements; node uses the current base function with the derived constructor and its hook.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static hook(): void { log.push("hook", this, this.seed); }
  static run(this: typeof Base, value: unknown): unknown { log.push("base", this, value); this.hook(); return value; }
}
class Derived extends Base {
  static override seed: unknown = "derived";
  static override hook(): void { log.push("derived-hook", this, this.seed); }
  static override run(this: typeof Base, value: unknown): unknown { log.push("derived", this, value); return super.run(value); }
}
class Further extends Derived { static override seed: unknown = "further"; }
class Sibling extends Derived { static override seed: unknown = "sibling"; }
const original = Base.run;
const replacement = function(this: typeof Base, value: unknown): unknown { log.push("replacement", this, value); this.hook(); return value; };
const constructors: (typeof Base)[] = [Derived, Further, Sibling];
for (const changed of [false, true]) {
  Base.run = changed ? replacement : original;
  for (const receiver of constructors) for (const value of [-0, NaN, "text", { token: 9 }]) {
    log.length = 0; const result = receiver.run(value);
    assert.sameValue(result, value); assert.sameValue(typeof result, typeof value);
    assert.compareArray(log, ["derived", receiver, value, changed ? "replacement" : "base", receiver, value, "derived-hook", receiver, receiver.seed]);
    assert.sameValue(Base.seed, "base"); assert.sameValue(Base.run, changed ? replacement : original);
  }
}
