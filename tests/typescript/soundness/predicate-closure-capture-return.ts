/*---
description: A lying predicate leaves a string in a claimed numeric closure capture through a number-typed return.
features: [ts-unsound-predicate, ts-closures, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown, ts-objects]
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
  function read(): number {
    return value;
  }
  const result: number = read();
  assert.sameValue(typeof result, "string");
  assert.sameValue(String(result + 1), "71");
}
exercise();
