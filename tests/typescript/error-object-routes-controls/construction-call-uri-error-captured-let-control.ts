/*---
description: "Control: URIError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-closures, ts-arrow-functions, ts-function-types, ts-instanceof]
flags: [module]
---*/
// Control: URIError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a closure over a mutable message binding.
// Node prints: construction-call-uri-error-captured-let:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalTexts: string[] = ["URIError", "URIError: alpha", "URIError: omega"];
let literalIndex: number = 0;
function literalFactory(message: string): Fault { return new Fault("URIError", message, undefined, literalTexts[literalIndex++]); }
let current: string = "unread";
const make: () => Error = () => literalFactory(current);
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = (current = message, make());
  assert.sameValue(true, true);
  assert.sameValue(value.name, "URIError");
  assert.sameValue(value.message, message);
  assert.sameValue(true, true);
}
console.log("construction-call-uri-error-captured-let:ok");
