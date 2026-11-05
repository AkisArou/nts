/*---
description: "CopyWithin applies negative source and destination bounds without losing signed bytes in overlapping copies through a private signed byte-array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-unions, ts-null-undefined, ts-destructuring]
---*/

// CopyWithin applies negative source and destination bounds without losing signed bytes in overlapping copies; route: a private signed byte-array field. Node prints copies-copy-within-negative-private-field:ok.
type View = Int8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox {
  #data: View = new Int8Array([-128, -1, 127, 8, 0]);
  copy(target: number, start: number, end: number | undefined): View { return this.#data.copyWithin(target, start, end); }
  original(): View { return this.#data; }
}
const rows: readonly [number, number, number | undefined, readonly number[]][] = [
  [0, -3, undefined, [127, 8, 0, 8, 0]], [-3, 0, -2, [-128, -1, -128, -1, 127]],
];
for (const [target, start, end, expected] of rows) {
  const box: CopyBox = new CopyBox(), source: View = box.original(), buffer = source.buffer;
  const result: View = box.copy(target, start, end);
  assert.sameValue(result, source); assert.sameValue(result.buffer, buffer);
  assert.compareArray(elements(source), expected);
}
console.log("copies-copy-within-negative-private-field:ok");
