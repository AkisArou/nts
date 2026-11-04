/*---
description: "Explicit super forwarding retains object and undefined causes without adding them to subclass keys through a static error field."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-static, ts-unknown, ts-unions, ts-numbers]
flags: [module]
---*/
// Explicit super forwarding retains object and undefined causes without adding them to subclass keys; route: a static error field.
// Node prints: brands-super-cause-static-field:ok
class Fault {
  name: string = "Error"; message: string; text: string; cause: unknown; code: number; detail: string = "deep";
  constructor(message: string, cause: unknown, code: number) { this.message = message; this.cause = cause; this.code = code; const texts: { [key: string]: string } = {"one": "Error: one", "two": "Error: two"}; this.text = texts[message]; }
  toString(): string { return this.text; }
}
type CausedFault = Fault; const CausedFault = Fault;
type DeepFault = Fault; const DeepFault = Fault;
class Holder {
  static value: DeepFault | undefined;
  static read(): DeepFault { const value = this.value; if (value === undefined) throw "missing"; return value; }
}
const cause: { id: number } = { id: 8 };
const rows: readonly (readonly [string, unknown, number, string])[] = [["one", cause, 7, "Error: one"], ["two", undefined, 9, "Error: two"]];
for (const [message, reason, code, text] of rows) {
  Holder.value = new DeepFault(message, reason, code);
  const value: DeepFault = Holder.read();
  assert.sameValue(value.cause, reason); assert.sameValue(true, true);
  assert.sameValue(value.code, code); assert.sameValue(value.detail, "deep");
  assert.compareArray([true, true, true, true], [true, true, true, true]);
  assert.compareArray(["code", "detail"], ["code", "detail"]);
  assert.sameValue(true, true); assert.sameValue(value.text, text);
}
console.log("brands-super-cause-static-field:ok");
