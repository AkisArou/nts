/*---
description: "Empty and reversed slice ranges still allocate a fresh zero-offset array of the receiver kind through a static Uint32 array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-static, ts-readonly, ts-instanceof]
---*/

// Empty and reversed slice ranges still allocate a fresh zero-offset array of the receiver kind; route: a static Uint32 array field. Node prints copies-slice-empty-static-field:ok.
type View = Uint32Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class WordBank { static data: View = new Uint32Array([]); }
const inputs: readonly (readonly number[])[] = [[], [0], [4294967295, 0, 7, 8]];
for (const input of inputs) {
  WordBank.data = new Uint32Array(input);
  const result: View = WordBank.data.slice(3, 1);
  assert.sameValue(result instanceof Uint32Array, true); assert.sameValue(result === WordBank.data, false);
  assert.sameValue(result.buffer === WordBank.data.buffer, false); assert.sameValue(result.byteOffset, 0);
  assert.sameValue(result.length, 0); assert.compareArray(elements(result), []);
  assert.compareArray(elements(WordBank.data), input);
}
console.log("copies-slice-empty-static-field:ok");
