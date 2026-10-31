/*---
description: Control for call-construct-date-call-new-field; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-instanceof, ts-objects]
---*/
// Paired case: ../builtin-identity/call-construct-date-call-new-field.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function check(t: number): void {
  const holder: { target: DateConstructor; value: number } = { target: Date, value: t };
  const before = Date.now();
  const text = Date();
  const after = Date.now();
  assert.sameValue(typeof text, "string");
  const parsed = Date.parse(text);
  const low = before < after ? before : after;
  const high = before > after ? before : after;
  assert.sameValue(parsed >= low - 999 && parsed <= high, true);
  const date = new Date(holder.value);
  assert.sameValue(date instanceof Date, true);
  assert.sameValue(date.getTime(), t);
  assert.sameValue(date.valueOf(), t);
}
for (const t of [-86400001, -1, 0, 1, 1700000000123]) check(t);
