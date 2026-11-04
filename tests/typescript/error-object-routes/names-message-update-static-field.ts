/*---
description: "Message reassignment changes every later template conversion including the empty-message branch through a static Error field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-static, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-template-literals]
flags: [module]
---*/
// Message reassignment changes every later template conversion including the empty-message branch; route: a static Error field.
// Node prints: names-message-update-static-field:ok
class Holder {
  static error: Error = new Error("initial");
  static change(message: string): string { Holder.error.message = message; return `${Holder.error}`; }
  static read(): string { return `${Holder.error}`; }
}
assert.sameValue(Holder.read(), "Error: initial");
const rows: readonly (readonly [string, string])[] = [["next", "Error: next"], ["", "Error"], ["final", "Error: final"]];
for (const [message, expected] of rows) {
  const text: string = Holder.change(message);
  assert.sameValue(text, expected); assert.sameValue(Holder.read(), expected); assert.sameValue(Holder.error.message, message);
}
console.log("names-message-update-static-field:ok");
