/*---
description: A parameter retains a numeric refinement after a captured write.
features: [ts-unsound-refinement, ts-functions, ts-narrowing, ts-unions, ts-typeof-operator, ts-conversions, ts-closures]
---*/

// TypeScript keeps a parameter narrowed to number across a closure call that reassigns it.
// The next narrow call receives the actual string; node concatenates it.
function observe(value: number): void {
  assert.sameValue(typeof value, "string");
  assert.sameValue(String(value + 1), "71");
}
function check(value: number | string): void {
  function mutate(): void { value = "7"; }
  if (typeof value !== "number") throw new Test262Error("expected initial number");
  mutate();
  observe(value);
}
check(1);
