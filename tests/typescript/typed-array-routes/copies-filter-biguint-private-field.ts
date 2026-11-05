/*---
description: "Filter preserves exact unsigned 64 bit elements and creates independent same-kind storage for partial all and empty results through a private unsigned bigint-array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions]
---*/

// Filter preserves exact unsigned 64 bit elements and creates independent same-kind storage for partial all and empty results; route: a private unsigned bigint-array field. Node prints copies-filter-biguint-private-field:ok.
type View = BigUint64Array;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox {
  #data: View;
  constructor(input: readonly bigint[]) { this.#data = new BigUint64Array(input); }
  select(): View { return this.#data.filter(value => value !== 0n); }
  original(): View { return this.#data; }
}
const rows: readonly [readonly bigint[], readonly bigint[]][] = [
  [[0n, 18446744073709551615n, 1n], [18446744073709551615n, 1n]], [[0n, 0n], []], [[1n, 2n], [1n, 2n]],
];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), source: View = box.original(), result: View = box.select();
  assert.sameValue(result instanceof BigUint64Array, true); assert.sameValue(result === source, false);
  assert.sameValue(result.buffer === source.buffer, false); assert.compareArray(elements(result), expected);
  if (result.length > 0) result[0] = 9n;
  assert.compareArray(elements(source), input);
}
console.log("copies-filter-biguint-private-field:ok");
