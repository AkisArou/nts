/*---
description: Object.setPrototypeOf supplies a literal method base before calls through an array containing the home and an inheriting receiver.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-functions, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// super.run crosses Runner array elements after setPrototypeOf; node starts at the home prototype for both the home and its child and writes only the receiver.
interface State { raw: number; seen: number; }
interface Runner extends State { run(value: number): number; }
const log: unknown[] = [];
const base = { run(this: State, value: number): number { log.push("base", this, value); this.seen = value; return this.raw * 2 + value; } };
const home = { raw: 11, seen: 0,
  run(this: State, value: number): number { log.push("home", this, value); return super.run(value); } };
Object.setPrototypeOf(home, base);
const child: Runner = Object.create(home); child.raw = 20; child.seen = 0;
const receivers: Runner[] = [home, child];
for (const input of [-2, -0, 2.5]) for (const receiver of receivers) {
  log.length = 0;
  const result = receiver.run(input);
  assert.sameValue(result, receiver.raw * 2 + input); assert.sameValue(typeof result, "number");
  assert.sameValue(receiver.seen, input); assert.sameValue(typeof receiver.seen, "number");
  assert.sameValue(Object.hasOwn(receiver, "seen"), true); assert.sameValue(Object.hasOwn(base, "seen"), false);
  assert.sameValue(Object.hasOwn(child, "run"), false);
  assert.compareArray(log, ["home", receiver, input, "base", receiver, input]);
}
