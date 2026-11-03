/*---
description: A method retained in a tuple keeps its home after the defining method property is replaced.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-function-types, ts-this-parameter, ts-tuples, ts-typeof-operator]
---*/
// super.run(value) in a tuple-stored method; node retains the saved function home even after Derived.prototype.run changes.
const log: unknown[] = [];
class Base {
  seed: unknown = "base";
  run(this: Base, value: unknown): unknown { log.push("base", this, value, this.seed); return value; }
}
class Derived extends Base {
  override seed: unknown = "derived";
  override run(this: Base, value: unknown): unknown { log.push("saved", this, value); return super.run(value); }
}
class Further extends Derived { override seed: unknown = "further"; }
class Sibling extends Base { override seed: unknown = "sibling"; }
type Method = (this: Base, value: unknown) => unknown;
const saved: Method = Derived.prototype.run;
const replacement: Method = function(value: unknown): unknown { log.push("replacement", this, value); return "wrong"; };
Derived.prototype.run = replacement;
for (const receiver of [new Derived(), new Further(), new Sibling()]) for (const value of [-0, "text", { token: 4 }]) {
  const route: [Method, Base] = [saved, receiver]; log.length = 0;
  const result = route[0].call(route[1], value);
  assert.sameValue(result, value); assert.sameValue(typeof result, typeof value);
  assert.compareArray(log, ["saved", receiver, value, "base", receiver, value, receiver.seed]);
  assert.sameValue(route[0], saved); assert.sameValue(route[1], receiver);
  assert.sameValue(Derived.prototype.run, replacement); assert.sameValue(saved === replacement, false);
}
