/*---
description: An Int8 length creates zeros while of creates one element.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples]
---*/
// An Int8 length creates zeros while of creates one element. Route: two factory interface implementations.
// Node prints construction-layout-length-of-interface:ok after exact observations.
type Samples = Int8Array;
interface SampleFactory { make(value: number): Samples; }
class LengthFactory implements SampleFactory { make(value: number): Samples { return new Int8Array(value); } }
class ValueFactory implements SampleFactory { make(value: number): Samples { return Int8Array.of(value); } }
const factories: readonly [SampleFactory, boolean][] = [[new LengthFactory(), true], [new ValueFactory(), false]];
const rows: readonly [number, readonly number[]][] = [[0, []], [1, [0]], [3, [0, 0, 0]]];
for (const [factory, isLength] of factories) for (const [value, zeroes] of rows) {
  const data = factory.make(value), expected = isLength ? zeroes : [value], observed: number[] = [];
  assert.sameValue(data.length, expected.length);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-length-of-interface:ok");
