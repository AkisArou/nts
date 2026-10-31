/*---
description: Control for call-construct-error-call-field; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-errors, ts-instanceof, ts-strings, ts-objects]
---*/
// Paired case: ../builtin-identity/call-construct-error-call-field.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(message: string): Error {
  const holder: { target: ErrorConstructor; value: string } = { target: Error, value: message };
  return Error(holder.value);
}
for (const message of ["", "problem", "delta: \u03b4"]) {
  const result = build(message);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
}
