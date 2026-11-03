/*---
description: A literal method copied onto a different-prototype object retains its original home when called through a class field. The control uses an original-home prototype method called with the copied-to this.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-class, ts-class-fields, ts-functions, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-typeof-type]
---*/
// The copied super.run method crosses Holder.current; node selects the original base, uses the copied-to receiver and never calls its decoy prototype. The control resolves the original home prototype at each use.
interface State { raw: number; seen: string; }
interface Runner extends State { run(value: number): number; }
const log: unknown[] = [];
const base = { run(this: State, value: number): number { log.push("base", this, value); this.seen = "base"; return this.raw + value + 10; } };
const decoy = { run(this: State, value: number): number { log.push("decoy", this, value); this.seen = "decoy"; return -999; } };
const home = { __proto__: base,
  run(this: State, value: number): number { log.push("home", this, value); const prototype: typeof base = Object.getPrototypeOf(home); return prototype.run.call(this, value); } };
class Holder { current: Runner; constructor(current: Runner) { this.current = current; } }
for (const input of [-2, -0, 2.5]) {
  const copied = { __proto__: decoy, raw: 20, seen: "idle", run: home.run }, holder = new Holder(copied);
  log.length = 0;
  const result = holder.current.run(input), prototype: object = Object.getPrototypeOf(copied);
  assert.sameValue(result, 30 + input); assert.sameValue(typeof result, "number");
  assert.sameValue(copied.seen, "base"); assert.sameValue(typeof copied.seen, "string");
  assert.sameValue(holder.current.run, home.run); assert.sameValue(typeof holder.current.run, "function");
  assert.sameValue(prototype, decoy); assert.sameValue(Object.hasOwn(copied, "run"), true);
  assert.sameValue(Object.hasOwn(base, "seen"), false); assert.sameValue(Object.hasOwn(decoy, "seen"), false);
  assert.sameValue(Object.hasOwn(home, "seen"), false);
  assert.compareArray(log, ["home", copied, input, "base", copied, input]);
}
