/*---
description: "Control: Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-narrowing, ts-null-undefined, ts-unknown, ts-objects, ts-numbers]
flags: [module]
---*/
// Control: Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity. Route: a guarded Map.get value.
// Node prints: construction-cause-map:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalOwn: boolean[] = [false, false, false, true, true, true, true, true, true];
let literalIndex: number = 0;
const first = { id: 1 }, second = { id: 2 };
const inputs: Error[] = [new Fault("SyntaxError", "m", undefined, "SyntaxError: m"), new Fault("SyntaxError", "m", undefined, "SyntaxError: m"), new Fault("SyntaxError", "m", undefined, "SyntaxError: m"), new Fault("SyntaxError", "m", undefined, "SyntaxError: m"), new Fault("SyntaxError", "m", first, "SyntaxError: m"), new Fault("SyntaxError", "m", second, "SyntaxError: m"), new Fault("SyntaxError", "m", 0, "SyntaxError: m"), new Fault("SyntaxError", "m", false, "SyntaxError: m"), new Fault("SyntaxError", "m", null, "SyntaxError: m")];
const expected: unknown[] = [undefined, undefined, undefined, undefined, first, second, 0, false, null];
const own: boolean[] = [false, false, false, true, true, true, true, true, true];
const slots: Map<number, Error> = new Map();
for (let index = 0; index < inputs.length; index++) {
  slots.set(index, inputs[index]);
  const selected = slots.get(index); if (selected === undefined) throw "missing error";
  const value: Error = selected;
  assert.sameValue(value.cause, expected[index]);
  assert.sameValue(literalOwn[literalIndex++], own[index]);
}
console.log("construction-cause-map:ok");
