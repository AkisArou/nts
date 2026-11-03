/*---
description: Explicit control — A returned super method is unbound and retains its identity across later base method replacement.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-function-types, ts-this-parameter, ts-typeof-operator]
---*/
// Same typed route; Reflect.get(Base.prototype, "run", this) returns the same unbound method value for the declared callable return.
const log: unknown[] = [];
class Base {
  seed: unknown = "base";
  run(this: Base, value: unknown): unknown { log.push("old", this, value, this.seed); return value; }
}
type Method = (this: Base, value: unknown) => unknown;
class Derived extends Base { take(): Method { log.push("take", this); const method: Method = Reflect.get(Base.prototype, "run", this); return method; } }
class Further extends Derived { override seed: unknown = "further"; }
class Sibling extends Base { override seed: unknown = "sibling"; }
const original: Method = Base.prototype.run;
const replacement: Method = function(value: unknown): unknown { log.push("new", this, value, this.seed); return value; };
for (const source of [new Derived(), new Further()]) for (const value of [-0, NaN, "text", { token: 6 }]) {
  Base.prototype.run = original; const receiver: Base = new Sibling(); log.length = 0;
  const saved: Method = source.take(); Base.prototype.run = replacement;
  const oldResult = saved.call(receiver, value); const fresh: Method = source.take();
  const newResult = fresh.call(receiver, value);
  assert.sameValue(saved, original); assert.sameValue(fresh, replacement); assert.sameValue(saved === fresh, false);
  assert.sameValue(oldResult, value); assert.sameValue(newResult, value);
  assert.sameValue(typeof oldResult, typeof value); assert.sameValue(typeof newResult, typeof value);
  assert.compareArray(log, ["take", source, "old", receiver, value, "sibling", "take", source, "new", receiver, value, "sibling"]);
}
