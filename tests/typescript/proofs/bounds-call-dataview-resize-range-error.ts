/*---
description: A tracking DataView shrinks from 4 to 2 bytes; getUint32(0) throws RangeError.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-errors, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Arrays: a guard proves four readable bytes before the callee shrinks the buffer.
// A tracking DataView shrinks from 4 to 2 bytes; getUint32(0) throws RangeError.
function resize(buffer: ArrayBuffer, size: number): void { buffer.resize(size); }
function read(size: number): number {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new DataView(buffer);
  view.setUint32(0, 0x11223344);
  const index = 0;
  if (index + 4 <= view.byteLength) {
    resize(buffer, size);
    return view.getUint32(index);
  }
  return -1;
}
for (const size of [0, 2, 3, 4, 8]) {
  if (size < 4) assert.throws(RangeError, () => read(size));
  else assert.sameValue(read(size), 0x11223344);
}
