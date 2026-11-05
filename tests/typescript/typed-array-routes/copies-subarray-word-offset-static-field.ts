/*---
description: "Subarray offsets count Int16 elements as two bytes without inspecting byte order through a static Int16 array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
---*/

// Subarray offsets count Int16 elements as two bytes without inspecting byte order; route: a static Int16 array field. Node prints copies-subarray-word-offset-static-field:ok.
type View = Int16Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class ShortBank { static data: View = new Int16Array([-32768, -7, 32767, 10]); }
const rows: readonly [number, number, readonly number[]][] = [[1, 2, [-7, 32767, 10]], [-1, 6, [10]], [4, 8, []]];
for (const [start, offset, expected] of rows) {
  const part: View = ShortBank.data.subarray(start);
  assert.sameValue(part instanceof Int16Array, true); assert.sameValue(part.buffer, ShortBank.data.buffer);
  assert.sameValue(part.byteOffset, offset); assert.sameValue(part.byteLength, expected.length * 2);
  assert.compareArray(elements(part), expected); assert.compareArray(elements(ShortBank.data), [-32768, -7, 32767, 10]);
}
console.log("copies-subarray-word-offset-static-field:ok");
