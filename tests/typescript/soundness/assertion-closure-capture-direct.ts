/*---
description: A lying assertion function leaves a string in a claimed numeric closure capture through a direct read.
features: [ts-unsound-assertion, ts-closures, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown, ts-objects]
---*/
// TypeScript trusts the lying assertion function for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberState(value: unknown): asserts value is { value: number } {}
function exercise(): void {
  const state: unknown = { value: "7" };
  assertNumberState(state);
  const value: number = state.value;
  function inspect(): string {
    return typeof value + ":" + String(value + 1);
  }
  assert.sameValue(inspect(), "string:71");
}
exercise();
