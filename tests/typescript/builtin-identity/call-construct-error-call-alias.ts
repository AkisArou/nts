/*---
description: Error called without new through a typed alias retains its class, name and message.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-errors, ts-instanceof, ts-strings]
---*/
// Route: Error called without new through a typed alias; node preserves the target and argument semantics.
function build(message: string): Error {
  const target: ErrorConstructor = Error;
  return target(message);
}
for (const message of ["", "problem", "delta: \u03b4"]) {
  const result = build(message);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
}
