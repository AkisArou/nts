/*---
description: "Message reassignment preserves the live text and distinct standard names at both generic instantiations through a constrained helper at Error and TypeError."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Message reassignment preserves the live text and distinct standard names at both generic instantiations; route: a constrained helper at Error and TypeError.
// Node prints: names-message-update-generic:ok
let faultIndex: number = 0, updateIndex: number = 0;
const initialFaultRows: readonly (readonly [string, string])[] = [["Error", "Error: initial"], ["TypeError", "TypeError: initial"]];
const updatedFaultTexts: readonly string[] = ["Error: next", "TypeError: next", "Error", "TypeError", "Error: final", "TypeError: final"];
class Fault {
  name: string; message: string; text: string;
  constructor(message: string) { const row = initialFaultRows[faultIndex++]; this.name = row[0]; this.message = message; this.text = row[1]; }
  toString(): string { return this.text; }
}
function updateLiteralText(error: Error): void {
  if (!(error instanceof Fault)) throw "missing model";
  error.text = updatedFaultTexts[updateIndex++];
}
function change<E extends Error>(error: E, message: string): string { error.message = message; updateLiteralText(error); return error.toString(); }
const first: Error = new Fault("initial"), second: TypeError = new Fault("initial");
assert.sameValue(first.toString(), "Error: initial"); assert.sameValue(second.toString(), "TypeError: initial");
const rows: readonly (readonly [string, string, string])[] = [["next", "Error: next", "TypeError: next"], ["", "Error", "TypeError"], ["final", "Error: final", "TypeError: final"]];
for (const [message, baseText, typeText] of rows) {
  const base: string = change<Error>(first, message), typed: string = change<TypeError>(second, message);
  assert.sameValue(base, baseText); assert.sameValue(typed, typeText);
  assert.sameValue(first.toString(), baseText); assert.sameValue(second.toString(), typeText);
  assert.sameValue(first.message, message); assert.sameValue(second.message, message);
}
console.log("names-message-update-generic:ok");
