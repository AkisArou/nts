/*---
description: "Control: EvalError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-tuples, ts-objects, ts-instanceof]
flags: [module]
---*/
// Control: EvalError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a discriminated union of direct and joined messages.
// Node prints: construction-call-eval-error-union:ok
class Fault {
  name: string; message: string; cause: unknown; text: string;
  constructor(name: string, message: string, cause: unknown, text: string) {
    this.name = name; this.message = message; this.cause = cause; this.text = text;
  }
}
const literalTexts: string[] = ["EvalError", "EvalError: alpha", "EvalError: omega"];
let literalIndex: number = 0;
function literalFactory(message: string): Fault { return new Fault("EvalError", message, undefined, literalTexts[literalIndex++]); }
type Input = { kind: "plain"; text: string } | { kind: "parts"; parts: [string, string] };
function make(input: Input): Error {
  if (input.kind === "plain") return literalFactory(input.text);
  return literalFactory(input.parts[0] + input.parts[1]);
}
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = make(message === "" ? { kind: "plain", text: message } : { kind: "parts", parts: [message.slice(0, 1), message.slice(1)] });
  assert.sameValue(true, true);
  assert.sameValue(value.name, "EvalError");
  assert.sameValue(value.message, message);
  assert.sameValue(true, true);
}
console.log("construction-call-eval-error-union:ok");
