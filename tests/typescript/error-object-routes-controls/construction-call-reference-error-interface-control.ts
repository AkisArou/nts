/*---
description: "Control: Two interface implementations call ReferenceError without new and preserve their distinct message values."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-interfaces, ts-numbers, ts-instanceof]
flags: [module]
---*/
// Control: Two interface implementations call ReferenceError without new and preserve their distinct message values. Route: an interface with direct and tagged factories.
// Node prints: construction-call-reference-error-interface:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalTexts: string[] = ["ReferenceError", "ReferenceError: tag:", "ReferenceError: alpha", "ReferenceError: tag:alpha", "ReferenceError: omega", "ReferenceError: tag:omega"];
let literalIndex: number = 0;
function literalFactory(message: string): Fault { return new Fault("ReferenceError", message, undefined, literalTexts[literalIndex++]); }
interface ErrorMaker { make(message: string): Error; }
class DirectMaker implements ErrorMaker { make(message: string): Error { return literalFactory(message); } }
class TaggedMaker implements ErrorMaker { make(message: string): Error { return literalFactory("tag:" + message); } }
const makers: ErrorMaker[] = [new DirectMaker(), new TaggedMaker()];
for (const message of ["", "alpha", "omega"]) for (let index = 0; index < makers.length; index++) {
  const value: Error = makers[index].make(message);
  assert.sameValue(true, true);
  assert.sameValue(value.name, "ReferenceError");
  assert.sameValue(value.message, index === 0 ? message : "tag:" + message);
  assert.sameValue(true, true);
}
console.log("construction-call-reference-error-interface:ok");
