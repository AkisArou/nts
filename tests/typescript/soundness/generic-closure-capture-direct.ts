/*---
description: Explicit generic widening leaves a string in a numeric closure capture through a direct read.
features: [ts-unsound-generic-widening, ts-closures, ts-typeof-operator, ts-conversions, ts-generics, ts-objects, ts-functions]
---*/
// TypeScript accepts the numeric method at an explicit unknown instantiation
// by bivariance. The captured number receives a string; node preserves it.
function inject<T>(sink: { put(value: T): void }, value: T): void {
  sink.put(value);
}
function exercise(): void {
  let value: number = 2;
  const sink = {
    put(next: number): void { value = next; }
  };
  function inspect(): string {
    return typeof value + ":" + String(value + 1);
  }
  inject<unknown>(sink, "7");
  assert.sameValue(inspect(), "string:71");
}
exercise();
