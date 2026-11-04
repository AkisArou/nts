/*---
description: "Explicit super forwarding retains object and undefined causes without adding them to subclass keys through a static error field."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-static, ts-unknown, ts-unions, ts-numbers]
flags: [module]
---*/
// Explicit super forwarding retains object and undefined causes without adding them to subclass keys; route: a static error field.
// Node prints: brands-super-cause-static-field:ok
class CausedFault extends Error {
  code: number;
  constructor(message: string, cause: unknown, code: number) { super(message, { cause }); this.code = code; }
}
class DeepFault extends CausedFault { detail: string = "deep"; }
class Holder {
  static value: DeepFault | undefined;
  static read(): DeepFault { const value = this.value; if (value === undefined) throw "missing"; return value; }
}
const cause: { id: number } = { id: 8 };
const rows: readonly (readonly [string, unknown, number, string])[] = [["one", cause, 7, "Error: one"], ["two", undefined, 9, "Error: two"]];
for (const [message, reason, code, text] of rows) {
  Holder.value = new DeepFault(message, reason, code);
  const value: DeepFault = Holder.read();
  assert.sameValue(value.cause, reason); assert.sameValue(Object.hasOwn(value, "cause"), true);
  assert.sameValue(value.code, code); assert.sameValue(value.detail, "deep");
  assert.compareArray([value instanceof CausedFault, value instanceof DeepFault, value instanceof Error, Error.isError(value)], [true, true, true, true]);
  assert.compareArray(Object.keys(value), ["code", "detail"]);
  assert.sameValue(Object.hasOwn(value, "message"), true); assert.sameValue(String(value), text);
}
console.log("brands-super-cause-static-field:ok");
