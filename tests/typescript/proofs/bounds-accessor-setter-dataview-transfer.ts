/*---
description: A setter transfers the buffer; a formerly valid DataView read throws TypeError.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-numbers, ts-errors, ts-closures, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Arrays: four readable bytes are guarded before the setter detaches the view.
// A setter transfers the buffer; a formerly valid DataView read throws TypeError.
function read(change: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, 0x11223344);
  const hook = { set effect(n: number) { if (n > 0) buffer.transfer(); } };
  const index = 0;
  if (index + 4 <= view.byteLength) { hook.effect = change; return view.getUint32(index); }
  return -1;
}
for (const change of [-1, 0, 1, 4]) {
  if (change > 0) assert.throws(TypeError, () => read(change));
  else assert.sameValue(read(change), 0x11223344);
}
