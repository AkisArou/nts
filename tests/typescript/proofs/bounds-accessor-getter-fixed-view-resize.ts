/*---
description: A getter makes a fixed view out of bounds; even its old index 0 is undefined.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-numbers, ts-null-undefined, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: fixed-view index 0 is guarded before the getter resizes its buffer.
// A getter makes a fixed view out of bounds; even its old index 0 is undefined.
function read(size: number): number | undefined {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Int32Array(buffer, 0, 2);
  view[0] = 17;
  const hook = { get effect(): number { buffer.resize(size); return 0; } };
  const index = 0;
  if (index < view.length) { hook.effect; return view[index]; }
  return -1;
}
for (const size of [0, 4, 7, 8]) assert.sameValue(read(size), size < 8 ? undefined : 17);
