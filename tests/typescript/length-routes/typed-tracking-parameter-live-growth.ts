/*---
description: A tracking Uint16Array parameter grows on the first loop body and a live bound visits every new zero-filled element.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-functions]
---*/
// A tracking Uint16Array parameter doubles after index zero; node visits the added elements exactly once.
type LengthTrace = (string | number | undefined)[];
function scanGrowingView(view: Uint16Array<ArrayBuffer>, buffer: ArrayBuffer, log: LengthTrace): void {
  const initial = view.length;
  for (let index = 0; index < view.length; index++) {
    const value: number | undefined = view[index]; log.push("read", index, value, view.length);
    if (index === 0) { buffer.resize(initial * 4); log.push("resize", buffer.byteLength, view.length); }
  }
}
const expectedLogs: LengthTrace[] = [[], ["read", 0, 10, 1, "resize", 4, 2, "read", 1, 0, 2, "final", 0, 10, 2, "final", 1, 0, 2], ["read", 0, 10, 3, "resize", 12, 6, "read", 1, 11, 6, "read", 2, 12, 6, "read", 3, 0, 6, "read", 4, 0, 6, "read", 5, 0, 6, "final", 0, 10, 6, "final", 1, 11, 6, "final", 2, 12, 6, "final", 3, 0, 6, "final", 4, 0, 6, "final", 5, 0, 6], ["read", 0, 10, 4, "resize", 16, 8, "read", 1, 11, 8, "read", 2, 12, 8, "read", 3, 13, 8, "read", 4, 0, 8, "read", 5, 0, 8, "read", 6, 0, 8, "read", 7, 0, 8, "final", 0, 10, 8, "final", 1, 11, 8, "final", 2, 12, 8, "final", 3, 13, 8, "final", 4, 0, 8, "final", 5, 0, 8, "final", 6, 0, 8, "final", 7, 0, 8]];
const expectedContents: number[][] = [[], [10, 0], [10, 11, 12, 0, 0, 0], [10, 11, 12, 13, 0, 0, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size * 2, { maxByteLength: size * 4 });
  const view: Uint16Array<ArrayBuffer> = new Uint16Array(buffer);
  for (let index = 0; index < size; index++) view[index] = 10 + index;
  scanGrowingView(view, buffer, log);
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
