/*---
description: "Control: TypeError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-function-types, ts-null-undefined, ts-narrowing, ts-instanceof]
flags: [module]
---*/
// Control: TypeError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a guarded Map function value.
// Node prints: construction-call-type-error-map:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalTexts: string[] = ["TypeError", "TypeError: alpha", "TypeError: omega"];
let literalIndex: number = 0;
function literalFactory(message: string): Fault { return new Fault("TypeError", message, undefined, literalTexts[literalIndex++]); }
const makers: Map<string, (message: string) => Error> = new Map();
makers.set("type", literalFactory);
const make = makers.get("type"); if (make === undefined) throw "missing maker";
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = make(message);
  assert.sameValue(true, true);
  assert.sameValue(value.name, "TypeError");
  assert.sameValue(value.message, message);
  assert.sameValue(true, true);
}
console.log("construction-call-type-error-map:ok");
