/*---
description: "Message reassignment changes every later String conversion including the empty-message branch through a guarded Map.get."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-map-set, ts-narrowing, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Message reassignment changes every later String conversion including the empty-message branch; route: a guarded Map.get.
// Node prints: names-message-update-map:ok
let faultIndex: number = 0, updateIndex: number = 0;
const initialFaultRows: readonly (readonly [string, string])[] = [["Error", "Error: initial"]];
const updatedFaultTexts: readonly string[] = ["Error: next", "Error", "Error: final"];
class Fault {
  name: string; message: string; text: string;
  constructor(message: string) { const row = initialFaultRows[faultIndex++]; this.name = row[0]; this.message = message; this.text = row[1]; }
  toString(): string { return this.text; }
}
function updateLiteralText(error: Error): void {
  if (!(error instanceof Fault)) throw "missing model";
  error.text = updatedFaultTexts[updateIndex++];
}
const held: Map<string, Error> = new Map([["current", new Fault("initial")]]);
function change(key: string, message: string): string {
  const error = held.get(key); if (error === undefined) throw "missing";
  error.message = message; updateLiteralText(error); return String(error);
}
const first = held.get("current"); if (first === undefined) throw "missing";
assert.sameValue(String(first), "Error: initial");
const rows: readonly (readonly [string, string])[] = [["next", "Error: next"], ["", "Error"], ["final", "Error: final"]];
for (const [message, expected] of rows) {
  const text: string = change("current", message);
  const error = held.get("current"); if (error === undefined) throw "missing";
  assert.sameValue(text, expected); assert.sameValue(String(error), expected); assert.sameValue(error.message, message);
}
console.log("names-message-update-map:ok");
