/*---
description: "Control: RangeError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-function-types, ts-instanceof]
flags: [module]
---*/
// Control: RangeError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a readonly callable-constructor array.
// Node prints: construction-call-range-error-readonly:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalTexts: string[] = ["RangeError", "RangeError: alpha", "RangeError: omega"];
let literalIndex: number = 0;
function literalFactory(message: string): Fault { return new Fault("RangeError", message, undefined, literalTexts[literalIndex++]); }
const makers: readonly ((message: string) => Error)[] = [literalFactory];
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = makers[0](message);
  assert.sameValue(true, true);
  assert.sameValue(value.name, "RangeError");
  assert.sameValue(value.message, message);
  assert.sameValue(true, true);
}
console.log("construction-call-range-error-readonly:ok");
