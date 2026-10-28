/*---
description: A closure returning a number preserves the string stored in its numeric capture.
features: [ts-unsound-bivariance, ts-closures, ts-typeof-operator, ts-conversions, ts-functions, ts-objects]
---*/
// TypeScript's method-signature bivariance lets a string enter the numeric
// variable both functions capture. Node's closure reads keep the actual string.
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
}
function exercise(): void {
  let value: number = 2;
  const sink = {
    put(next: number): void { value = next; }
  };
  function read(): number {
    return value;
  }
  inject(sink);
  const result: number = read();
  assert.sameValue(typeof result, "string");
  assert.sameValue(String(result + 1), "71");
}
exercise();
