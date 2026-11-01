/*---
description: Writes using a saved parameter-view bound after a shrink to zero are ignored and every regrown byte remains zero.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-functions]
---*/
// A typed tracking parameter keeps an old bound after shrinking to zero; node ignores each old-index write and regrows only zeroes.
type LengthTrace = (string | number | undefined)[];
function writeAfterShrink(view: Uint8Array<ArrayBuffer>, buffer: ArrayBuffer, log: LengthTrace): void {
  const limit = view.length;
  for (let index = 0; index <= limit; index++) {
    if (index === 0) { buffer.resize(0); log.push("shrink", buffer.byteLength, view.length); }
    view[index] = 90 + index; log.push("write", index, 90 + index, view.length);
    const value: number | undefined = view[index]; log.push("read", index, value, view.length);
    if (index === limit) { buffer.resize(limit * 2); log.push("regrow", buffer.byteLength, view.length); }
  }
}
const expectedLogs: LengthTrace[] = [["shrink", 0, 0, "write", 0, 90, 0, "read", 0, undefined, 0, "regrow", 0, 0], ["shrink", 0, 0, "write", 0, 90, 0, "read", 0, undefined, 0, "write", 1, 91, 0, "read", 1, undefined, 0, "regrow", 2, 2, "final", 0, 0, 2, "final", 1, 0, 2], ["shrink", 0, 0, "write", 0, 90, 0, "read", 0, undefined, 0, "write", 1, 91, 0, "read", 1, undefined, 0, "write", 2, 92, 0, "read", 2, undefined, 0, "write", 3, 93, 0, "read", 3, undefined, 0, "regrow", 6, 6, "final", 0, 0, 6, "final", 1, 0, 6, "final", 2, 0, 6, "final", 3, 0, 6, "final", 4, 0, 6, "final", 5, 0, 6], ["shrink", 0, 0, "write", 0, 90, 0, "read", 0, undefined, 0, "write", 1, 91, 0, "read", 1, undefined, 0, "write", 2, 92, 0, "read", 2, undefined, 0, "write", 3, 93, 0, "read", 3, undefined, 0, "write", 4, 94, 0, "read", 4, undefined, 0, "regrow", 8, 8, "final", 0, 0, 8, "final", 1, 0, 8, "final", 2, 0, 8, "final", 3, 0, 8, "final", 4, 0, 8, "final", 5, 0, 8, "final", 6, 0, 8, "final", 7, 0, 8]];
const expectedContents: number[][] = [[], [0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size, { maxByteLength: size * 2 });
  const view: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  for (let index = 0; index < size; index++) view[index] = 10 + index;
  writeAfterShrink(view, buffer, log);
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
