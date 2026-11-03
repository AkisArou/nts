/*---
description: An arrow in a method keeps its receiver while looking up the base method at each later call.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-function-types, ts-this-parameter, ts-arrow-functions, ts-typeof-operator]
---*/
// super.run(value) in an array-stored arrow; node ignores call receiver replacement but observes the current base method.
const log: unknown[] = [];
class Base {
  seed: unknown = "base";
  run(this: Base, value: unknown): unknown { log.push("old", this, value, this.seed); return value; }
}
class Derived extends Base {
  override seed: unknown = "derived";
  make(): (value: unknown) => unknown {
    log.push("make", this);
    return (value: unknown): unknown => { log.push("arrow", this, value); return super.run(value); };
  }
}
class Further extends Derived { override seed: unknown = "further"; }
class Sibling extends Derived { override seed: unknown = "sibling"; }
const original = Base.prototype.run;
const replacement = function(this: Base, value: unknown): unknown { log.push("new", this, value, this.seed); return value; };
for (const receiver of [new Derived(), new Further(), new Sibling()]) {
  log.length = 0; const callbacks: ((value: unknown) => unknown)[] = [receiver.make()]; const other: Base = new Base();
  assert.compareArray(log, ["make", receiver]);
  for (const changed of [false, true]) for (const value of [-0, "text", { token: 7 }]) {
    Base.prototype.run = changed ? replacement : original; log.length = 0;
    const result = callbacks[0].call(other, value);
    assert.sameValue(result, value); assert.sameValue(typeof result, typeof value); assert.sameValue(other.seed, "base");
    assert.compareArray(log, ["arrow", receiver, value, changed ? "new" : "old", receiver, value, receiver.seed]);
  }
}
