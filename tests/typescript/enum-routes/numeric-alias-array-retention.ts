/*---
description: "Equal-valued enum members retain all array positions while their later names win the reverse mapping."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-enum, ts-enum-reverse-mapping]
---*/
// Status aliases 4 and -2; a typed array parameter is copied into a returned enum array, and node keeps all five slots while reporting the last declaration for each shared value.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum Status { First = 4, Later = 4, Next = 5, Back = -2, LastBack = -2 }
function retain(values: readonly Status[]): Status[] { const copy: Status[] = []; for (const value of values) copy.push(value); return copy; }
const inputs: Status[] = [Status.First, Status.Later, Status.Next, Status.Back, Status.LastBack];
const expected = [4, 4, 5, -2, -2], names = ["Later", "Later", "Next", "LastBack", "LastBack"];
for (const values of [inputs, retain(inputs)]) {
  const result: Status[] = retain(values); same(Object.is(result, values), false); exact(values, expected); exact(result, expected);
  const observed: string[] = []; for (let index = 0; index < result.length; index++) { same(result[index], expected[index]); observed.push(Status[result[index]]); }
  exact(observed, names); same(result.length, 5);
}
