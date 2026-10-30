/*---
description: Loop effects on a Uint16Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the loop route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads 50003 + (7 + change) after the change, otherwise 50003.
function read(change: number): number {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  let view = new Uint16Array(buffer, 2, 3);
  const index = 2;
  view[index] = 50003;
  if (index < view.length) {
    let observed: number = 50003;
    for (const turn of [0, 1, 2, 3, 4, 5, 6]) {
      if (turn >= change) break;
      observed = view[index];
      if (turn === 0) {
        const moved = buffer.transferToFixedLength(16);
        view = new Uint16Array(moved, 2, 3);
        view[index] += 7 + change;
      }
    }
    return observed;
  }
  return -999;
}
for (const change of [0, 1, 2, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change >= 2 ? 50003 + (7 + change) : 50003);
}
