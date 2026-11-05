/*---
description: "From copies a Set in deduplicated insertion order using each implementation's element conversion. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-unions, ts-interfaces, ts-class, ts-map-set, ts-tuples, ts-destructuring]
---*/

function localInteger(value: number, width: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** width, n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localFromInt16Array(values: Iterable<number>): number[] { const result: number[] = []; for (const value of values) result[result.length] = localInteger(value, 16, true); return result; }
function localFromFloat64Array(values: Iterable<number>): number[] { const result: number[] = []; for (const value of values) result[result.length] = value; return result; }
// From copies a Set in deduplicated insertion order using each implementation's element conversion. Route: one factory interface with integer and floating implementations.
// Node prints construction-input-from-set-interface:ok.
type Samples = number[];
interface InputFactory { make(values: Iterable<number>): Samples; }
class WholeFactory implements InputFactory { make(values: Iterable<number>): Samples { return localFromInt16Array(values); } }
class RealFactory implements InputFactory { make(values: Iterable<number>): Samples { return localFromFloat64Array(values); } }
const rows: readonly [InputFactory, readonly number[]][] = [[new WholeFactory(), [3, -1, 2]], [new RealFactory(), [3, -1, 2.5]]];
for (const [factory, expected] of rows) {
  const values: Set<number> = new Set([3, 3, -1, 2.5, -1]), result = factory.make(values), actual: number[] = [];
  values.add(9);
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.length, 3);
}
console.log("construction-input-from-set-interface:ok");
