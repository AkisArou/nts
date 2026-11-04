/*---
description: "Control: Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-this, ts-unknown, ts-objects, ts-numbers]
flags: [module]
---*/
// Control: Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity. Route: a public Error field.
// Node prints: construction-cause-public-field:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalOwn: boolean[] = [false, false, false, true, true, true, true, true, true];
let literalIndex: number = 0;
const first = { id: 1 }, second = { id: 2 };
const inputs: Error[] = [new Fault("Error", "m", undefined, "Error: m"), new Fault("Error", "m", undefined, "Error: m"), new Fault("Error", "m", undefined, "Error: m"), new Fault("Error", "m", undefined, "Error: m"), new Fault("Error", "m", first, "Error: m"), new Fault("Error", "m", second, "Error: m"), new Fault("Error", "m", 0, "Error: m"), new Fault("Error", "m", false, "Error: m"), new Fault("Error", "m", null, "Error: m")];
const expected: unknown[] = [undefined, undefined, undefined, undefined, first, second, 0, false, null];
const own: boolean[] = [false, false, false, true, true, true, true, true, true];
class Holder { value: Error; constructor(value: Error) { this.value = value; } }
const holder = new Holder(inputs[0]);
for (let index = 0; index < inputs.length; index++) {
  holder.value = inputs[index];
  const value: Error = holder.value;
  assert.sameValue(value.cause, expected[index]);
  assert.sameValue(literalOwn[literalIndex++], own[index]);
}
console.log("construction-cause-public-field:ok");
