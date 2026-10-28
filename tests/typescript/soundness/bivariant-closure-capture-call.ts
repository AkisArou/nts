/*---
description: A string stored in a numeric closure capture reaches a number parameter unchanged.
features: [ts-unsound-bivariance, ts-closures, ts-typeof-operator, ts-conversions, ts-functions, ts-objects]
---*/
// TypeScript's method-signature bivariance lets a string enter the numeric
// variable both functions capture. Node's closure reads keep the actual string.
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
}
function exercise(): void {
  let value: number = 2;
  const sink = {
    put(next: number): void { value = next; }
  };
  function inspect(): string {
    return describe(value);
  }
  inject(sink);
  assert.sameValue(inspect(), "string:71");
}
exercise();
