/*---
description: The transfer arm makes a previously safe view index undefined.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before the switch can detach its buffer.
// The transfer arm makes a previously safe view index undefined.
function read(mode: number): number | undefined {
  const buffer = new ArrayBuffer(4);
  const view = new Uint8Array(buffer);
  view[0] = 17;
  const index = 0;
  if (index < view.length) {
    switch (mode) {
      case 1: case 3: buffer.transfer(); break;
      default: break;
    }
    return view[index];
  }
  return -1;
}
for (const mode of [-1, 0, 1, 2, 3]) assert.sameValue(read(mode), mode === 1 || mode === 3 ? undefined : 17);
