/*---
description: After index 3 is proved safe, Number(value) shrinks its buffer; reusing index 3 gives undefined.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-numbers, ts-null-undefined, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: numeric index 3 is guarded before Number invokes the resizing hook.
// After index 3 is proved safe, Number(value) shrinks its buffer; reusing index 3 gives undefined.
function read(size: number): number | undefined {
  const buffer = new ArrayBuffer(4, { maxByteLength: 4 });
  const view = new Uint8Array(buffer);
  view[3] = 44;
  const hook = { valueOf(): number { buffer.resize(size); return 0; } };
  const index = 3;
  if (index < view.length) { Number(hook); return view[index]; }
  return -1;
}
for (const size of [0, 1, 3, 4]) assert.sameValue(read(size), size < 4 ? undefined : 44);
