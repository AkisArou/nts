/*---
description: "ToReversed copies exact signed 64 bit values without sharing later writes through a private BigInt64 array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
---*/

// ToReversed copies exact signed 64 bit values without sharing later writes; route: a private BigInt64 array field. Node prints copies-to-reversed-bigint-private-field:ok.
type View = BigInt64Array;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox {
  #data: View;
  constructor(input: readonly bigint[]) { this.#data = new BigInt64Array(input); }
  copy(): View { return this.#data.toReversed(); }
  original(): View { return this.#data; }
}
const rows: readonly [readonly bigint[], readonly bigint[]][] = [
  [[-9223372036854775808n, 1n, 9223372036854775807n], [9223372036854775807n, 1n, -9223372036854775808n]], [[7n, -1n, 0n], [0n, -1n, 7n]],
];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), source: View = box.original(), result: View = box.copy();
  assert.sameValue(result instanceof BigInt64Array, true); assert.sameValue(result.buffer === source.buffer, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(source), input);
  result[0] = 8n; assert.compareArray(elements(source), input);
}
console.log("copies-to-reversed-bigint-private-field:ok");
