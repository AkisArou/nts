/*---
description: "Control: Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-static, ts-unknown, ts-objects, ts-numbers]
flags: [module]
---*/
// Control: Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity. Route: a static Error field.
// Node prints: construction-cause-static-field:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalOwn: boolean[] = [false, false, false, true, true, true, true, true, true];
let literalIndex: number = 0;
const first = { id: 1 }, second = { id: 2 };
const inputs: Error[] = [new Fault("RangeError", "m", undefined, "RangeError: m"), new Fault("RangeError", "m", undefined, "RangeError: m"), new Fault("RangeError", "m", undefined, "RangeError: m"), new Fault("RangeError", "m", undefined, "RangeError: m"), new Fault("RangeError", "m", first, "RangeError: m"), new Fault("RangeError", "m", second, "RangeError: m"), new Fault("RangeError", "m", 0, "RangeError: m"), new Fault("RangeError", "m", false, "RangeError: m"), new Fault("RangeError", "m", null, "RangeError: m")];
const expected: unknown[] = [undefined, undefined, undefined, undefined, first, second, 0, false, null];
const own: boolean[] = [false, false, false, true, true, true, true, true, true];
class Holder { static value: Error; }
for (let index = 0; index < inputs.length; index++) {
  Holder.value = inputs[index];
  const value: Error = Holder.value;
  assert.sameValue(value.cause, expected[index]);
  assert.sameValue(literalOwn[literalIndex++], own[index]);
}
console.log("construction-cause-static-field:ok");
