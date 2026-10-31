/*---
description: A typed Date alias is callable as a string producer and constructible with a time value.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-instanceof]
---*/
// Route: call and construction of the same typed Date alias; node preserves the target and argument semantics.
function check(t: number): void {
  const target: DateConstructor = Date;
  const before = Date.now();
  const text = target();
  const after = Date.now();
  assert.sameValue(typeof text, "string");
  const parsed = Date.parse(text);
  const low = before < after ? before : after;
  const high = before > after ? before : after;
  assert.sameValue(parsed >= low - 999 && parsed <= high, true);
  const date = new target(t);
  assert.sameValue(date instanceof Date, true);
  assert.sameValue(date.getTime(), t);
  assert.sameValue(date.valueOf(), t);
}
for (const t of [-86400001, -1, 0, 1, 1700000000123]) check(t);
