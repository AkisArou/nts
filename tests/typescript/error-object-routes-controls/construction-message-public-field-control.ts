/*---
description: "Control: Omitted and undefined messages have no own property; empty and nonempty messages have an own property."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-this, ts-numbers]
flags: [module]
---*/
// Control: Omitted and undefined messages have no own property; empty and nonempty messages have an own property. Route: a public Error field.
// Node prints: construction-message-public-field:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalOwn: boolean[] = [false, false, true, true];
let literalIndex: number = 0;
const inputs: Error[] = [new Fault("Error", "", undefined, "Error"), new Fault("Error", "", undefined, "Error"), new Fault("Error", "", undefined, "Error"), new Fault("Error", "alpha", undefined, "Error: alpha")];
const expected: string[] = ["", "", "", "alpha"];
const own: boolean[] = [false, false, true, true];
class Holder { value: Error; constructor(value: Error) { this.value = value; } }
const holder = new Holder(inputs[0]);
for (let index = 0; index < inputs.length; index++) {
  holder.value = inputs[index];
  const value: Error = holder.value;
  assert.sameValue(value.name, "Error");
  assert.sameValue(value.message, expected[index]);
  assert.sameValue(literalOwn[literalIndex++], own[index]);
}
console.log("construction-message-public-field:ok");
