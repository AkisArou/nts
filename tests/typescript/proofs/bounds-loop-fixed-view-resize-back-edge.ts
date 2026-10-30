/*---
description: Shrinking an 8-byte buffer to 4 invalidates its fixed Int32Array view; index 0 is undefined.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: fixed view index 0 is initially inside its two entries.
// Shrinking an 8-byte buffer to 4 invalidates its fixed Int32Array view; index 0 is undefined.
function read(turns: number): number | undefined {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Int32Array(buffer, 0, 2);
  view[0] = 17;
  let result: number | undefined = 17;
  for (let turn = 0; turn < turns; turn++) {
    result = view[0];
    buffer.resize(4);
  }
  return result;
}
for (const turns of [0, 1, 2, 3, 7]) assert.sameValue(read(turns), turns < 2 ? 17 : undefined);
