/*---
description: An extracted literal method and an unrelated receiver cross a typed tuple while the method keeps its original home. The control uses an original-home prototype lookup and explicit receiver call.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-functions, ts-function-types, ts-this, ts-this-parameter, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator, ts-typeof-type]
---*/
// The saved super.run function crosses a typed method/receiver tuple; node uses the original base and each explicitly supplied this, regardless of receiver ancestry. The control resolves the original home prototype at each use.
interface State { raw: number; seen: number; }
type Method = (this: State, value: number) => number;
const log: unknown[] = [];
const base = { run(this: State, value: number): number { log.push("base", this, value); this.seen = value; return this.raw * 3 + value; } };
const decoy = { run(this: State, value: number): number { log.push("decoy", this, value); return -999; } };
const home = { __proto__: base,
  run(this: State, value: number): number { log.push("home", this, value); const prototype: typeof base = Object.getPrototypeOf(home); return prototype.run.call(this, value); } };
const plain = { raw: 9, seen: 0 }, foreign = { __proto__: decoy, raw: 19, seen: 0 };
const rows: [Method, State][] = [[home.run, plain], [home.run, foreign]];
for (const input of [-2, -0, 2.5]) for (const [method, receiver] of rows) {
  log.length = 0;
  const result = method.call(receiver, input);
  assert.sameValue(method, home.run); assert.sameValue(typeof method, "function");
  assert.sameValue(result, receiver.raw * 3 + input); assert.sameValue(typeof result, "number");
  assert.sameValue(receiver.seen, input); assert.sameValue(typeof receiver.seen, "number");
  assert.sameValue(Object.hasOwn(receiver, "seen"), true); assert.sameValue(Object.hasOwn(home, "seen"), false);
  assert.sameValue(Object.hasOwn(base, "seen"), false); assert.sameValue(Object.hasOwn(decoy, "seen"), false);
  assert.compareArray(log, ["home", receiver, input, "base", receiver, input]);
}
