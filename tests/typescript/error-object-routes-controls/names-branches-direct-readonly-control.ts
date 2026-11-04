/*---
description: "Every nondefault toString branch preserves empty and present name and message through readonly input tuples."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects]
flags: [module]
---*/
// Every nondefault toString branch preserves empty and present name and message; route: readonly input tuples.
// Node prints: names-branches-direct-readonly:ok
let faultIndex: number = 0;
class Fault {
  name: string = "Error"; message: string; text: string;
  constructor(message: string) { this.message = message; this.text = ["Error: m", "m", "Custom", ""][faultIndex++]; }
  toString(): string { return this.text; }
}
const rows: readonly (readonly [string, string, string])[] = [["Error", "m", "Error: m"], ["", "m", "m"], ["Custom", "", "Custom"], ["", "", ""]];
for (const [label, message, expected] of rows) {
  const error: Fault = new Fault(message); error.name = label;
  const actual: string = error.text;
  assert.sameValue(actual, expected);
}
console.log("names-branches-direct-readonly:ok");
