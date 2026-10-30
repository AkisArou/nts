/*---
description: Loop effects on a Uint16Array view: the original fixed subview survives a shrink to 6 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the loop route.
// The original fixed subview survives a shrink to 6 bytes and reads a fresh sibling write; node reads 4097 + change after the change, otherwise 50003.
function read(change: number): { value: number; bytes: number } {
  const buffer = new ArrayBuffer(16, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 2, 2);
  const index = 1;
  view[index] = 50003;
  if (index < view.length) {
    let observed: number = 50003;
    let turn = 0;
    if (change > 0) do {
      observed = view[index];
      if (turn === 0) {
        buffer.resize(6);
        const sibling = new Uint16Array(buffer, 2, 2);
        sibling[index] = 4097 + change;
      }
      turn++;
    } while (turn < change);
    return { value: observed, bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
for (const change of [0, 1, 2, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change >= 2 ? 4097 + change : 50003);
  assert.sameValue(result.bytes, change > 0 ? 6 : 16);
}
