/*---
description: "Map converts callback results into a fresh receiver-kind array and later copy writes remain independent through a declared callback field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions]
---*/

// Map converts callback results into a fresh receiver-kind array and later copy writes remain independent; route: a declared callback field. Node prints copies-map-callback-field:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox {
  data: View;
  mapper: (value: number) => number = value => value * 2;
  constructor(input: readonly number[]) { this.data = new Uint8Array(input); }
}
const rows: readonly [readonly number[], readonly number[]][] = [[[200, 100, 1], [144, 200, 2]], [[0, 127, 128], [0, 254, 0]]];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), result: View = box.data.map(box.mapper);
  assert.sameValue(result instanceof Uint8Array, true); assert.sameValue(result.buffer === box.data.buffer, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(box.data), input);
  result[1] = 9; assert.compareArray(elements(box.data), input);
}
console.log("copies-map-callback-field:ok");
