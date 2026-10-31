/*---
description: Control for call-construct-error-call-alias; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-errors, ts-instanceof, ts-strings]
---*/
// Paired case: ../builtin-identity/call-construct-error-call-alias.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(message: string): Error {
  const target: ErrorConstructor = Error;
  return Error(message);
}
for (const message of ["", "problem", "delta: \u03b4"]) {
  const result = build(message);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
}
