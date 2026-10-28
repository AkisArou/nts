/*---
description: A closure directly reads the string a bivariant method sink stored in its numeric capture.
features: [ts-unsound-bivariance, ts-closures, ts-typeof-operator, ts-conversions, ts-objects, ts-functions]
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
  function inspect(): string {
    return typeof value + ":" + String(value + 1);
  }
  inject(sink);
  assert.sameValue(inspect(), "string:71");
}
exercise();
