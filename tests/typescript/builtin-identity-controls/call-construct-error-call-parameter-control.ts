/*---
description: Control for call-construct-error-call-parameter; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-errors, ts-instanceof, ts-strings, ts-call-signatures]
---*/
// Paired case: ../builtin-identity/call-construct-error-call-parameter.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(target: ErrorConstructor, message: string): Error {
  return Error(message);
}
for (const message of ["", "problem", "delta: \u03b4"]) {
  const result = build(Error, message);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
}
