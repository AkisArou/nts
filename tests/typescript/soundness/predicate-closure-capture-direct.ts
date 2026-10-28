/*---
description: A lying predicate leaves a string in a claimed numeric closure capture through a direct read.
features: [ts-unsound-predicate, ts-closures, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown, ts-objects]
---*/
// TypeScript trusts the lying predicate for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberState(value: unknown): value is { value: number } {
  return true;
}
function exercise(): void {
  const state: unknown = { value: "7" };
  if (!isNumberState(state)) throw new Test262Error("predicate rejected the fixture");
  const value: number = state.value;
  function inspect(): string {
    return typeof value + ":" + String(value + 1);
  }
  assert.sameValue(inspect(), "string:71");
}
exercise();
