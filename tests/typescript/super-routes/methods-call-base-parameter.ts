/*---
description: A base parameter lends an override to a sibling while a base callback can throw on that receiver.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-this-parameter, ts-arrow-functions, ts-typeof-operator]
---*/
// super.run(value) via a Base parameter and a borrowed override; node calls the receiver hook and preserves its abrupt completion.
const log: unknown[] = []; const failure = new RangeError("sibling hook");
class Base {
  seed: unknown = "base";
  hook(value: unknown): unknown { log.push("hook", this, value, this.seed); return value; }
  run(this: Base, value: unknown): unknown {
    log.push("base", this, value);
    try { return this.hook(value); } finally { log.push("base-finally", this); }
  }
}
class Derived extends Base {
  override seed: unknown = "derived";
  override run(this: Base, value: unknown): unknown { log.push("derived", this, value); return super.run(value); }
}
class Further extends Derived { override seed: unknown = "further"; }
class Sibling extends Base {
  override seed: unknown = "sibling";
  override hook(value: unknown): unknown { log.push("throw-hook", this, value, this.seed); throw failure; }
}
function invoke(receiver: Base, value: unknown): unknown { log.push("invoke", receiver, value); return Derived.prototype.run.call(receiver, value); }
const receivers: Base[] = [new Derived(), new Further(), new Sibling()];
for (const receiver of receivers) for (const value of [-0, "text", { token: 2 }]) {
  log.length = 0;
  if (receiver.seed === "sibling") {
    assert.throws(RangeError, () => { try { invoke(receiver, value); } catch (error) { assert.sameValue(error, failure); throw error; } });
  } else { const result = invoke(receiver, value); assert.sameValue(result, value); assert.sameValue(typeof result, typeof value); }
  assert.compareArray(log, ["invoke", receiver, value, "derived", receiver, value, "base", receiver, value,
    receiver.seed === "sibling" ? "throw-hook" : "hook", receiver, value, receiver.seed, "base-finally", receiver]);
}
