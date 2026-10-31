/*---
description: Error called without new through a typed parameter retains its class, name and message.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-errors, ts-instanceof, ts-strings, ts-call-signatures]
---*/
// Route: Error called without new through a typed parameter; node preserves the target and argument semantics.
function build(target: ErrorConstructor, message: string): Error {
  return target(message);
}
for (const message of ["", "problem", "delta: \u03b4"]) {
  const result = build(Error, message);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
}
