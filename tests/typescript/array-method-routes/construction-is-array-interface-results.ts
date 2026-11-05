/*---
description: "Array.isArray classifies values returned by real-array and lookalike interface implementations."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-readonly, ts-unknown, ts-objects, ts-strings, ts-tuples, ts-destructuring]
---*/

// Array.isArray classifies values returned by real-array and lookalike interface implementations. Route: two interface implementations returning unknown values. Node prints construction-is-array-interface-results:ok.
interface ArrayProvider { read(index: number): unknown; }
class RealArraySource implements ArrayProvider {
  values: readonly number[][] = [[], [7, 8]]; read(index: number): unknown { return this.values[index]; }
}
class OtherArraySource implements ArrayProvider {
  values: readonly unknown[] = [new Uint8Array([7]), { 0: 7, length: 1 }, "7"];
  read(index: number): unknown { return this.values[index]; }
}
const real = new RealArraySource(), other = new OtherArraySource();
const rows: readonly [ArrayProvider, number, boolean][] = [[real, 0, true], [real, 1, true], [other, 0, false], [other, 1, false], [other, 2, false]];
for (const [provider, index, expected] of rows) {
  const result = Array.isArray(provider.read(index));
  assert.sameValue(result, expected);
}
console.log("construction-is-array-interface-results:ok");
