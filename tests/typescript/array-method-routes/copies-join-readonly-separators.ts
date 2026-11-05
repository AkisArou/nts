/*---
description: "Join uses the requested separator and commas inside nested arrays without changing the source through readonly separator tuples."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-null-undefined]
---*/

// Join uses the requested separator and commas inside nested arrays without changing the source; route: readonly separator tuples.
// Node prints copies-join-readonly-separators:ok.
type JoinValue = number | string | null | undefined | JoinValue[];
const tail: number[] = [3, 4], nested: JoinValue[] = [2, tail];
const input: readonly JoinValue[] = [1, null, undefined, nested];
const rows: readonly [string | undefined, string][] = [[undefined, "1,,,2,3,4"], ["-", "1---2,3,4"], ["", "12,3,4"], ["::", "1::::::2,3,4"]];
for (const [separator, expected] of rows) {
  const result = input.join(separator);
  assert.sameValue(result, expected);
  assert.compareArray(input, [1, null, undefined, nested]);
  assert.compareArray(nested, [2, tail]);
  assert.compareArray(tail, [3, 4]);
}
console.log("copies-join-readonly-separators:ok");
