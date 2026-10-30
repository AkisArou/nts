/*---
description: A stored buffer alias transfers ownership; old view read is undefined.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before a stored buffer alias is transferred.
// A stored buffer alias transfers ownership; old view read is undefined.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(4);
  const holder = { buffer };
  const view = new Int32Array(buffer);
  view[0] = 17;
  const index = 0;
  if (index < view.length) {
    if (change > 0) holder.buffer.transfer();
    return view[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 17);
