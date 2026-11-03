/*---
description: A stored literal writer calls the initial base setter then throws TypeError after its home is retargeted to a getter-only prototype.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-function-types, ts-functions, ts-accessors, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-errors, ts-arrow-functions]
---*/
// super.value assignment crosses an interface-held writer before and after setPrototypeOf; node writes the first receiver value, then throws without calling the getter or changing state.
interface State { raw: number; }
interface Slot { write: (this: State, value: number) => number; }
const log: unknown[] = [];
const writable = { raw: -100, set value(value: number) { log.push("set", this, value); this.raw = value; } };
const readonly = { raw: -200, get value(): number { log.push("get", this); return this.raw; } };
const home = { __proto__: writable,
  put(this: State, value: number): number { log.push("put", this, value); return super.value = value; } };
const slot: Slot = { write: home.put };
for (const value of [-0, 2.5, -3]) {
  const receiver: State = { raw: 13 };
  Object.setPrototypeOf(home, writable); log.length = 0;
  const written = slot.write.call(receiver, value);
  assert.sameValue(written, value); assert.sameValue(typeof written, "number");
  assert.sameValue(receiver.raw, value); assert.sameValue(typeof receiver.raw, "number");
  assert.sameValue(Object.hasOwn(receiver, "raw"), true); assert.sameValue(Object.hasOwn(receiver, "value"), false);
  assert.sameValue(writable.raw, -100); assert.sameValue(readonly.raw, -200);
  Object.setPrototypeOf(home, readonly);
  assert.throws(TypeError, () => slot.write.call(receiver, value + 1));
  assert.sameValue(receiver.raw, value); assert.sameValue(typeof receiver.raw, "number");
  assert.sameValue(Object.hasOwn(receiver, "value"), false);
  assert.sameValue(writable.raw, -100); assert.sameValue(readonly.raw, -200);
  assert.sameValue(Object.hasOwn(writable, "value"), true); assert.sameValue(Object.hasOwn(readonly, "value"), true);
  assert.compareArray(log, ["put", receiver, value, "set", receiver, value, "put", receiver, value + 1]);
}
