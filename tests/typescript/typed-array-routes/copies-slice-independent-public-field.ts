/*---
description: "Slice copies signed elements into independent storage and later writes stay on their own side through a public Int16 array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-instanceof]
---*/

// Slice copies signed elements into independent storage and later writes stay on their own side; route: a public Int16 array field. Node prints copies-slice-independent-public-field:ok.
type View = Int16Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox {
  data: View;
  constructor(input: readonly number[]) { this.data = new Int16Array(input); }
  copy(): View { return this.data.slice(1, 3); }
}
for (const input of [[-32768, 7, 32767, 42], [-9, 0, 999, 17]]) {
  const box: CopyBox = new CopyBox(input), result: View = box.copy();
  assert.sameValue(result instanceof Int16Array, true); assert.sameValue(result.buffer === box.data.buffer, false);
  assert.sameValue(result.byteOffset, 0); assert.compareArray(elements(result), [input[1], input[2]]);
  result[0] = -1234; box.data[2] = 2222;
  assert.compareArray(elements(result), [-1234, input[2]]);
  assert.compareArray(elements(box.data), [input[0], input[1], 2222, input[3]]);
}
console.log("copies-slice-independent-public-field:ok");
