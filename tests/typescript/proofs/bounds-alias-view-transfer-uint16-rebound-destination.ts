/*---
description: Alias effects on a Uint16Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the alias route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads 50003 + (7 + change) after the change, otherwise 50003.
function read(change: number): number {
  const buffer = new ArrayBuffer(12);
  let view = new Uint16Array(buffer, 2, 3);
  const index = 2;
  view[index] = 50003;
  const alias = view;
  if (index < view.length) {
    if (change > 0) {
      const moved = alias.buffer.transferToFixedLength(16);
      view = new Uint16Array(moved, 2, 3);
      view[index] += 7 + change;
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? 50003 + (7 + change) : 50003);
}
