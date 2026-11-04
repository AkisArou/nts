/*---
description: "Template conversion sees the default text after each receiver replacement through a captured mutable Parts binding."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-declare-field, ts-this, ts-unions, ts-closures, ts-function-types, ts-arrow-functions, ts-narrowing, ts-arrays, ts-readonly, ts-tuples, ts-iteration, ts-template-literals]
flags: [module]
---*/
// Template conversion sees the default text after each receiver replacement; route: a captured mutable Parts binding.
// Node prints: names-defaults-template-captured-let:ok
let faultIndex: number = 0;
class Fault {
  name: string | undefined; message: string | undefined; text: string;
  constructor(name: string | undefined, message: string | undefined) { this.name = name; this.message = message; this.text = ["Error", "Error: m", "Custom", ""][faultIndex++]; }
  toString(): string { return this.text; }
}
type Parts = Fault; const Parts = Fault;
const rows: readonly (readonly [string | undefined, string | undefined, string])[] = [[undefined, undefined, "Error"], [undefined, "m", "Error: m"], ["Custom", undefined, "Custom"], ["", undefined, ""]];
let current: Parts | undefined;
const read: () => string = () => { if (current === undefined) throw "missing"; return current.text; };
for (const [label, message, expected] of rows) {
  current = new Parts(label, message);
  assert.sameValue(read(), expected);
}
console.log("names-defaults-template-captured-let:ok");
