/*---
description: "Control: A readonly error array distinguishes omitted and undefined messages from own empty and nonempty messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-numbers]
flags: [module]
---*/
// Control: A readonly error array distinguishes omitted and undefined messages from own empty and nonempty messages. Route: a readonly Error array.
// Node prints: construction-message-readonly:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalOwn: boolean[] = [false, false, true, true];
let literalIndex: number = 0;
const inputs: readonly Error[] = [new Fault("ReferenceError", "", undefined, "ReferenceError"), new Fault("ReferenceError", "", undefined, "ReferenceError"), new Fault("ReferenceError", "", undefined, "ReferenceError"), new Fault("ReferenceError", "alpha", undefined, "ReferenceError: alpha")];
const expected: string[] = ["", "", "", "alpha"];
const own: boolean[] = [false, false, true, true];
for (let index = 0; index < inputs.length; index++) {
  const value: Error = inputs[index];
  assert.sameValue(value.message, expected[index]);
  assert.sameValue(literalOwn[literalIndex++], own[index]);
}
console.log("construction-message-readonly:ok");
