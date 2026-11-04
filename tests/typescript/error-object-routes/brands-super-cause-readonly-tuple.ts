/*---
description: "Explicit super forwarding keeps undefined and object causes own and preserves both tuple member layouts through a readonly subclass tuple."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-unknown, ts-numbers]
flags: [module]
---*/
// Explicit super forwarding keeps undefined and object causes own and preserves both tuple member layouts; route: a readonly subclass tuple.
// Node prints: brands-super-cause-readonly-tuple:ok
class FirstFault extends Error {
  code: number = 1;
  constructor(message: string, cause: unknown) { super(message, { cause }); }
}
class DeepFault extends FirstFault { label: string = "child"; }
const reason: { id: number } = { id: 6 };
const values: readonly [FirstFault, DeepFault] = [new FirstFault("first", undefined), new DeepFault("second", reason)];
const reasons: readonly unknown[] = [undefined, reason];
const texts: readonly string[] = ["Error: first", "Error: second"];
const keys: readonly (readonly string[])[] = [["code"], ["code", "label"]];
assert.sameValue(values[1].label, "child");
for (let index = 0; index < values.length; index++) {
  const value = values[index];
  assert.sameValue(value.cause, reasons[index]); assert.sameValue(value.code, 1);
  assert.sameValue(Object.hasOwn(value, "cause"), true); assert.sameValue(Object.hasOwn(value, "message"), true);
  assert.compareArray(Object.keys(value), keys[index]);
  assert.compareArray([value instanceof FirstFault, value instanceof DeepFault, value instanceof Error, Error.isError(value)], [true, index === 1, true, true]);
  assert.sameValue(String(value), texts[index]);
}
console.log("brands-super-cause-readonly-tuple:ok");
