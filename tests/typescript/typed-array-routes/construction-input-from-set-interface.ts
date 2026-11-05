/*---
description: "From copies a Set in deduplicated insertion order using each implementation's element conversion."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-unions, ts-interfaces, ts-class, ts-map-set, ts-tuples, ts-destructuring]
---*/

// From copies a Set in deduplicated insertion order using each implementation's element conversion. Route: one factory interface with integer and floating implementations.
// Node prints construction-input-from-set-interface:ok.
type Samples = Int16Array | Float64Array;
interface InputFactory { make(values: Iterable<number>): Samples; }
class WholeFactory implements InputFactory { make(values: Iterable<number>): Samples { return Int16Array.from(values); } }
class RealFactory implements InputFactory { make(values: Iterable<number>): Samples { return Float64Array.from(values); } }
const rows: readonly [InputFactory, readonly number[]][] = [[new WholeFactory(), [3, -1, 2]], [new RealFactory(), [3, -1, 2.5]]];
for (const [factory, expected] of rows) {
  const values: Set<number> = new Set([3, 3, -1, 2.5, -1]), result = factory.make(values), actual: number[] = [];
  values.add(9);
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.length, 3);
}
console.log("construction-input-from-set-interface:ok");
