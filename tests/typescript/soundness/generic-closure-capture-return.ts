/*---
description: Explicit generic widening leaves a string in a numeric closure capture through a numeric return.
features: [ts-unsound-generic-widening, ts-closures, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-objects]
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
  function read(): number {
    return value;
  }
  inject<unknown>(sink, "7");
  const result: number = read();
  assert.sameValue(typeof result, "string");
  assert.sameValue(String(result + 1), "71");
}
exercise();
