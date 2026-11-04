/*---
description: "Absent name and message use the Error text defaults through a constrained helper at two type arguments."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-declare-field, ts-this, ts-unions, ts-generics, ts-generic-constraints, ts-arrays, ts-readonly, ts-tuples, ts-iteration]
flags: [module]
---*/
// Absent name and message use the Error text defaults; route: a constrained helper at two type arguments.
// Node prints: names-defaults-direct-generic:ok
let faultIndex: number = 0;
class Fault {
  name: string | undefined; message: string | undefined; text: string;
  constructor(name: string | undefined, message: string | undefined) { this.name = name; this.message = message; this.text = ["Error", "Error: m", "Custom", ""][faultIndex++]; }
  toString(): string { return this.text; }
}
type Parts = Fault; const Parts = Fault;
const rows: readonly (readonly [string | undefined, string | undefined, string])[] = [[undefined, undefined, "Error"], [undefined, "m", "Error: m"], ["Custom", undefined, "Custom"], ["", undefined, ""]];
function describe<T extends { toString(): string }>(value: T): string { return value.toString(); }
for (let index = 0; index < rows.length; index++) {
  const [label, message, expected] = rows[index]; const value: Parts = new Parts(label, message);
  const actual: string = index % 2 === 0 ? describe<Parts>(value) : describe<{ toString(): string }>(value);
  assert.sameValue(actual, expected);
}
console.log("names-defaults-direct-generic:ok");
