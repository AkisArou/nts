/*---
description: "EvalError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-tuples, ts-objects, ts-instanceof]
flags: [module]
---*/
// EvalError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a discriminated union of direct and joined messages.
// Node prints: construction-call-eval-error-union:ok
type Input = { kind: "plain"; text: string } | { kind: "parts"; parts: [string, string] };
function make(input: Input): Error {
  if (input.kind === "plain") return EvalError(input.text);
  return EvalError(input.parts[0] + input.parts[1]);
}
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = make(message === "" ? { kind: "plain", text: message } : { kind: "parts", parts: [message.slice(0, 1), message.slice(1)] });
  assert.sameValue(value instanceof EvalError, true);
  assert.sameValue(value.name, "EvalError");
  assert.sameValue(value.message, message);
  assert.sameValue(Object.hasOwn(value, "message"), true);
}
console.log("construction-call-eval-error-union:ok");
