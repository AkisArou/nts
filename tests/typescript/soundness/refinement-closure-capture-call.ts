/*---
description: A captured variable retains a numeric refinement after a mutating call.
features: [ts-unsound-refinement, ts-closures, ts-narrowing, ts-unions, ts-functions, ts-typeof-operator, ts-conversions, ts-arrow-functions]
---*/

// TypeScript retains the captured variable's number refinement across mutate().
// The next numeric parameter receives the actual string, which node concatenates.
function describe(value: number): string { return typeof value + ":" + String(value + 1); }
function makeReader(): () => string {
  let value: number | string = 1;
  function mutate(): void { value = "7"; }
  return () => {
    if (typeof value !== "number") throw new Test262Error("expected initial number");
    mutate();
    return describe(value);
  };
}
const read = makeReader();
assert.sameValue(read(), "string:71");
