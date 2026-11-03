/*---
description: An object literal with __proto__ calls its base method through an interface field while retaining the actual receiver and its writes.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-functions, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// super.run crosses Slot.current on a literal with __proto__; node enters home then base on the same receiver and preserves each argument and result.
interface State { raw: number; seen: number; }
interface Runner extends State { run(value: number): number; }
interface Slot { current: Runner; }
const log: unknown[] = [];
const base = { raw: -100, run(this: State, value: number): number { log.push("base", this, value); this.seen = value; return this.raw + value; } };
const home = { __proto__: base, raw: 10, seen: 0,
  run(this: State, value: number): number { log.push("home", this, value); return super.run(value); } };
const slot: Slot = { current: home };
for (const input of [-2, -0, 2.5]) {
  log.length = 0; slot.current.raw = 10 + input;
  const result = slot.current.run(input), prototype: object = Object.getPrototypeOf(home);
  assert.sameValue(result, 10 + input + input); assert.sameValue(typeof result, "number");
  assert.sameValue(slot.current.seen, input); assert.sameValue(typeof slot.current.seen, "number");
  assert.sameValue(base.raw, -100); assert.sameValue(Object.hasOwn(base, "seen"), false);
  assert.sameValue(Object.hasOwn(home, "seen"), true); assert.sameValue(Object.hasOwn(home, "__proto__"), false);
  assert.sameValue(prototype, base); assert.sameValue(typeof prototype, "object");
  assert.compareArray(log, ["home", home, input, "base", home, input]);
}
