/*---
description: Windows beyond the buffer throw while both widths admit an empty end window.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-errors]
---*/
// Windows beyond the buffer throw while both widths admit an empty end window. Route: two window factory interface implementations.
// Node prints construction-layout-window-overlong-interface:ok after exact observations.
type BufferStorage = ArrayBuffer;
type Samples = Int16Array | Int32Array;
interface WindowFactory { make(buffer: BufferStorage, offset: number, size: number): Samples; }
class NarrowFactory implements WindowFactory { make(buffer: BufferStorage, offset: number, size: number): Samples { return new Int16Array(buffer, offset, size); } }
class WideFactory implements WindowFactory { make(buffer: BufferStorage, offset: number, size: number): Samples { return new Int32Array(buffer, offset, size); } }
const rows: readonly [WindowFactory, number, number, number][] = [[new NarrowFactory(), 6, 2, 2], [new WideFactory(), 4, 2, 4], [new NarrowFactory(), 8, 1, 2], [new WideFactory(), 12, 0, 4]];
for (const [factory, offset, size, width] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(8);
  const fitted = factory.make(buffer, 0, 1); assert.sameValue(fitted.byteLength, width);
  assert.throws(RangeError, () => factory.make(buffer, offset, size));
  const data = factory.make(buffer, 8, 0), observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, 8);
  assert.sameValue(data.length, 0);
  assert.sameValue(data.byteLength, 0);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, []);
}
console.log("construction-layout-window-overlong-interface:ok");
