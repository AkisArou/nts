/*---
description: "Message reassignment preserves the live text and distinct standard names at both generic instantiations through a constrained helper at Error and TypeError."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Message reassignment preserves the live text and distinct standard names at both generic instantiations; route: a constrained helper at Error and TypeError.
// Node prints: names-message-update-generic:ok
function change<E extends Error>(error: E, message: string): string { error.message = message; return error.toString(); }
const first: Error = new Error("initial"), second: TypeError = new TypeError("initial");
assert.sameValue(first.toString(), "Error: initial"); assert.sameValue(second.toString(), "TypeError: initial");
const rows: readonly (readonly [string, string, string])[] = [["next", "Error: next", "TypeError: next"], ["", "Error", "TypeError"], ["final", "Error: final", "TypeError: final"]];
for (const [message, baseText, typeText] of rows) {
  const base: string = change<Error>(first, message), typed: string = change<TypeError>(second, message);
  assert.sameValue(base, baseText); assert.sameValue(typed, typeText);
  assert.sameValue(first.toString(), baseText); assert.sameValue(second.toString(), typeText);
  assert.sameValue(first.message, message); assert.sameValue(second.message, message);
}
console.log("names-message-update-generic:ok");
