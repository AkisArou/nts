/*---
description: "Control: SyntaxError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-generics, ts-generic-constraints, ts-function-types, ts-instanceof]
flags: [module]
---*/
// Control: SyntaxError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a generic callable helper at Error and SyntaxError result types.
// Node prints: construction-call-syntax-error-generic:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalTexts: string[] = ["SyntaxError", "SyntaxError: alpha", "SyntaxError: omega"];
let literalIndex: number = 0;
function literalFactory(message: string): Fault { return new Fault("SyntaxError", message, undefined, literalTexts[literalIndex++]); }
function invoke<T extends Error>(factory: (message: string) => T, message: string): T { return factory(message); }
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = message === "" ? invoke<Error>(literalFactory, message) : invoke<SyntaxError>(literalFactory, message);
  assert.sameValue(true, true);
  assert.sameValue(value.name, "SyntaxError");
  assert.sameValue(value.message, message);
  assert.sameValue(true, true);
}
console.log("construction-call-syntax-error-generic:ok");
