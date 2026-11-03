/*---
description: Explicit control — An interface field preserves the current base method and the derived receiver after replacement.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-interfaces, ts-this-parameter, ts-typeof-operator]
---*/
// Same typed route; Base.prototype.run.call(this, value) retains the current target, receiver, values and assertions.
const log: unknown[] = [];
interface Runner { run(value: unknown): unknown; }
interface Holder { receiver: Runner; }
class Base {
  seed: unknown = "base";
  hook(): void { log.push("hook", this, this.seed); }
  run(value: unknown): unknown { log.push("base", this, value); this.hook(); return value; }
}
class Derived extends Base {
  override seed: unknown = "derived";
  override hook(): void { log.push("derived-hook", this, this.seed); }
  override run(value: unknown): unknown { log.push("derived", this, value); return Base.prototype.run.call(this, value); }
}
class Further extends Derived { override seed: unknown = "further"; }
class Sibling extends Derived { override seed: unknown = "sibling"; }
const original = Base.prototype.run;
const replacement = function(this: Base, value: unknown): unknown { log.push("replacement", this, value); this.hook(); return value; };
const inputs: unknown[] = [-0, NaN, "text", undefined, { token: 1 }];
for (const changed of [false, true]) {
  Base.prototype.run = changed ? replacement : original;
  for (const receiver of [new Derived(), new Further(), new Sibling()]) for (const value of inputs) {
    const holder: Holder = { receiver }; log.length = 0;
    const result = holder.receiver.run(value);
    assert.sameValue(result, value); assert.sameValue(typeof result, typeof value);
    assert.compareArray(log, ["derived", receiver, value, changed ? "replacement" : "base", receiver, value, "derived-hook", receiver, receiver.seed]);
    assert.sameValue(holder.receiver, receiver); assert.sameValue(Base.prototype.run, changed ? replacement : original);
  }
}
