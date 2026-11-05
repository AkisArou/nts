/*---
description: "From supplies exact bigint values and indexes to a mapper reached through two constrained input types. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-bigint, ts-numbers, ts-interfaces, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-arrow-functions, ts-closures, ts-strings]
---*/

function localSigned(value: bigint): bigint { const modulus = 2n ** 64n, n = (value % modulus + modulus) % modulus; return n >= 2n ** 63n ? n - modulus : n; }
function localFromBigInt64Array(values: readonly bigint[], mapper: (value: bigint, index: number) => bigint): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = localSigned(mapper(values[i], i)); return result; }
// From supplies exact bigint values and indexes to a mapper reached through two constrained input types. Route: a constrained helper called at plain and tagged record type arguments.
// Node prints construction-input-from-bigint-mapper-generic:ok.
interface ScaleInput { values: readonly bigint[]; factor: bigint; }
interface TaggedScaleInput extends ScaleInput { label: string; }
function inspect<T extends ScaleInput>(input: T, expected: readonly bigint[], expectedLog: readonly (bigint | number)[]): void {
  const log: (bigint | number)[] = [];
  const result = localFromBigInt64Array(input.values, (value, index) => { log.push(value, index); return value * input.factor; }), actual: bigint[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.compareArray(log, expectedLog);
}
inspect<ScaleInput>({ values: [1n, 2n], factor: 2n }, [2n, 4n], [1n, 0, 2n, 1]);
inspect<TaggedScaleInput>({ values: [3n, -1n, 9007199254740993n], factor: -3n, label: "wide" }, [-9n, 3n, -27021597764222979n], [3n, 0, -1n, 1, 9007199254740993n, 2]);
console.log("construction-input-from-bigint-mapper-generic:ok");
