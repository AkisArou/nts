/*---
description: A generic caller observes both base methods when the same literal home prototype changes between two calls.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-generics, ts-generic-constraints, ts-functions, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// super.run crosses a generic receiver parameter before and after retargeting the home; node enters first then second while retaining the same receiver.
interface State { raw: number; seen: string; }
const log: unknown[] = [];
const first = { run(this: State, value: number): number { log.push("first", this, value); this.seen = "first"; return this.raw + value; } };
const second = { run(this: State, value: number): number { log.push("second", this, value); this.seen = "second"; return this.raw + value + 100; } };
const home = { __proto__: first, raw: 7, seen: "idle",
  run(this: State, value: number): number { log.push("home", this, value); return super.run(value); } };
function invoke<T extends { run(value: number): number }>(receiver: T, value: number): number { log.push("route", receiver, value); return receiver.run(value); }
for (const input of [-2, -0, 2.5]) {
  Object.setPrototypeOf(home, first); log.length = 0;
  const before = invoke(home, input);
  assert.sameValue(before, 7 + input); assert.sameValue(typeof before, "number");
  assert.sameValue(home.seen, "first"); assert.sameValue(typeof home.seen, "string");
  log.push("retarget", home, second); Object.setPrototypeOf(home, second);
  const after = invoke(home, input);
  assert.sameValue(after, 107 + input); assert.sameValue(typeof after, "number");
  assert.sameValue(home.seen, "second"); assert.sameValue(typeof home.seen, "string");
  assert.sameValue(Object.hasOwn(first, "seen"), false); assert.sameValue(Object.hasOwn(second, "seen"), false);
  assert.compareArray(log, ["route", home, input, "home", home, input, "first", home, input, "retarget", home, second,
    "route", home, input, "home", home, input, "second", home, input]);
}
