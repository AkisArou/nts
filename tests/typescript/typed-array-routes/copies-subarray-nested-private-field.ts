/*---
description: "Nested subarrays compose offsets and share writes in both directions through a private byte-array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-readonly]
---*/

// Nested subarrays compose offsets and share writes in both directions; route: a private byte-array field. Node prints copies-subarray-nested-private-field:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox {
  #data: View;
  constructor(input: readonly number[]) { this.#data = new Uint8Array(input); }
  cut(): View { const middle = this.#data.subarray(1); return middle.subarray(1, 3); }
  original(): View { return this.#data; }
}
for (const input of [[1, 2, 3, 4, 5], [200, 100, 50, 25, 7]]) {
  const box: CopyBox = new CopyBox(input), original: View = box.original(), part: View = box.cut();
  assert.sameValue(part.buffer, original.buffer); assert.sameValue(part.byteOffset, 2); assert.sameValue(part.length, 2);
  assert.compareArray(elements(part), [input[2], input[3]]);
  part[0] = 9; original[3] = 77;
  assert.compareArray(elements(original), [input[0], input[1], 9, 77, input[4]]);
  assert.compareArray(elements(part), [9, 77]);
}
console.log("copies-subarray-nested-private-field:ok");
