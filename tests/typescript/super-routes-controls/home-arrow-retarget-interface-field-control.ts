/*---
description: An arrow returned from a literal method retains its receiver while following the original home prototype after a later change. The control uses a fresh home-prototype method call inside the same lexical arrow.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-function-types, ts-functions, ts-arrow-functions, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-typeof-type]
---*/
// The super.run arrow crosses an interface field; node ignores call-supplied this and switches from first to second when the original home is retargeted. The control resolves the original home prototype at each use.
interface State { raw: number; seen: string; }
interface Slot { callback: (value: number) => number; }
const log: unknown[] = [];
const first = { run(this: State, value: number): number { log.push("first", this, value); this.seen = "first"; return this.raw + value + 1; } };
const second = { run(this: State, value: number): number { log.push("second", this, value); this.seen = "second"; return this.raw + value + 100; } };
const home = { __proto__: first, make(this: State): (value: number) => number { log.push("make", this);
  return (value: number): number => { log.push("arrow", this, value); const prototype: typeof first = Object.getPrototypeOf(home); return prototype.run.call(this, value); };
} };
for (const input of [-2, -0, 2.5]) {
  const receiver: State = { raw: 10, seen: "idle" }, ignored: State = { raw: 999, seen: "ignored" };
  Object.setPrototypeOf(home, first); log.length = 0;
  const slot: Slot = { callback: home.make.call(receiver) }, before = slot.callback.call(ignored, input);
  assert.sameValue(before, 11 + input); assert.sameValue(typeof before, "number");
  assert.sameValue(receiver.seen, "first"); assert.sameValue(typeof receiver.seen, "string");
  Object.setPrototypeOf(home, second);
  const after = slot.callback.call(ignored, input + 1);
  assert.sameValue(after, 111 + input); assert.sameValue(typeof after, "number");
  assert.sameValue(receiver.seen, "second"); assert.sameValue(typeof receiver.seen, "string");
  assert.sameValue(ignored.seen, "ignored"); assert.sameValue(ignored.raw, 999);
  assert.sameValue(Object.hasOwn(first, "seen"), false); assert.sameValue(Object.hasOwn(second, "seen"), false);
  assert.compareArray(log, ["make", receiver, "arrow", receiver, input, "first", receiver, input,
    "arrow", receiver, input + 1, "second", receiver, input + 1]);
}
