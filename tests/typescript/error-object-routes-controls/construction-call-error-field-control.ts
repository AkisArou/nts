/*---
description: "Control: Error called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-function-types, ts-instanceof]
flags: [module]
---*/
// Control: Error called without new creates the right native instance and preserves empty and nonempty own messages. Route: a public callable-constructor field.
// Node prints: construction-call-error-field:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalTexts: string[] = ["Error", "Error: alpha", "Error: omega"];
let literalIndex: number = 0;
function literalFactory(message: string): Fault { return new Fault("Error", message, undefined, literalTexts[literalIndex++]); }
class Maker { make: (message: string) => Error = literalFactory; }
const maker = new Maker();
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = maker.make(message);
  assert.sameValue(true, true);
  assert.sameValue(value.name, "Error");
  assert.sameValue(value.message, message);
  assert.sameValue(true, true);
}
console.log("construction-call-error-field:ok");
