/*---
description: "Template conversion selects every empty or present name and message branch through a public Error field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-class, ts-class-fields, ts-this, ts-template-literals]
flags: [module]
---*/
// Template conversion selects every empty or present name and message branch; route: a public Error field.
// Node prints: names-branches-template-public-field:ok
let faultIndex: number = 0;
class Fault {
  name: string = "Error"; message: string; text: string;
  constructor(message: string) { this.message = message; this.text = ["Error: m", "m", "Custom", ""][faultIndex++]; }
  toString(): string { return this.text; }
}
const rows: readonly (readonly [string, string, string])[] = [["Error", "m", "Error: m"], ["", "m", "m"], ["Custom", "", "Custom"], ["", "", ""]];
class Holder { error: Fault; constructor(error: Fault) { this.error = error; } read(): string { return this.error.text; } }
for (const [label, message, expected] of rows) {
  const error: Fault = new Fault(message); error.name = label;
  const holder: Holder = new Holder(error);
  assert.sameValue(holder.read(), expected);
}
console.log("names-branches-template-public-field:ok");
