/*---
description: A returned literal arrow keeps its receiver while a changed home prototype switches a super write from own data storage to a base setter.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-optional-properties, ts-function-types, ts-functions, ts-arrow-functions, ts-accessors, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// The declared arrow return carries super.slot assignment; node first creates the captured receiver slot, then calls the new home setter while retaining that old own slot.
interface State { raw: number; slot?: number; }
const log: unknown[] = [], data = { slot: -100 };
const setter = { raw: -200, set slot(value: number) { log.push("setter", this, value); this.raw = value; } };
const home = { __proto__: data, make(this: State): (value: number) => number { log.push("make", this);
  return (value: number): number => { log.push("arrow", this, value); return super.slot = value; };
} };
for (const value of [-0, 2.5, -3]) {
  const receiver: State = { raw: 11 }, ignored: State = { raw: 22 };
  Object.setPrototypeOf(home, data); log.length = 0;
  const write: (value: number) => number = home.make.call(receiver), first = write.call(ignored, value);
  assert.sameValue(first, value); assert.sameValue(typeof first, "number");
  assert.sameValue(receiver.slot, value); assert.sameValue(typeof receiver.slot, "number");
  assert.sameValue(receiver.raw, 11); assert.sameValue(Object.hasOwn(receiver, "slot"), true);
  assert.sameValue(data.slot, -100); assert.sameValue(setter.raw, -200);
  assert.sameValue(Object.hasOwn(ignored, "slot"), false); assert.sameValue(ignored.raw, 22);
  assert.compareArray(log, ["make", receiver, "arrow", receiver, value]);
  Object.setPrototypeOf(home, setter);
  const second = write.call(ignored, value + 1);
  assert.sameValue(second, value + 1); assert.sameValue(typeof second, "number");
  assert.sameValue(receiver.raw, value + 1); assert.sameValue(typeof receiver.raw, "number");
  assert.sameValue(receiver.slot, value); assert.sameValue(typeof receiver.slot, "number");
  assert.sameValue(Object.hasOwn(receiver, "slot"), true); assert.sameValue(Object.hasOwn(home, "slot"), false);
  assert.sameValue(data.slot, -100); assert.sameValue(setter.raw, -200);
  assert.sameValue(Object.hasOwn(setter, "slot"), true); assert.sameValue(Object.hasOwn(ignored, "slot"), false);
  assert.sameValue(ignored.raw, 22);
  assert.compareArray(log, ["make", receiver, "arrow", receiver, value, "arrow", receiver, value + 1, "setter", receiver, value + 1]);
}
