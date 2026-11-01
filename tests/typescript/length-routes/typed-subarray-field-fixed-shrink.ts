/*---
description: A fixed-end subarray stored in a typed field keeps its declared extent through an interrupted scan and ignores a larger parent after regrowth.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects, ts-typed-array-views]
---*/
// An explicit-end subarray in a Uint8Array field loses its whole extent mid-scan; node restores only its original length after growth.
type LengthTrace = (string | number | undefined)[];
interface LengthViewHolder { view: Uint8Array<ArrayBuffer>; }
const expectedLogs: LengthTrace[] = [["read", 0, undefined, 0, "shrink", 1, 0, "regrow", 4, 0], ["read", 0, 11, 1, "shrink", 1, 0, "read", 1, undefined, 0, "regrow", 6, 1, "final", 0, 0, 1], ["read", 0, 11, 3, "shrink", 2, 0, "read", 1, undefined, 0, "read", 2, undefined, 0, "read", 3, undefined, 0, "regrow", 10, 3, "final", 0, 11, 3, "final", 1, 0, 3, "final", 2, 0, 3], ["read", 0, 11, 4, "shrink", 3, 0, "read", 1, undefined, 0, "read", 2, undefined, 0, "read", 3, undefined, 0, "read", 4, undefined, 0, "regrow", 12, 4, "final", 0, 11, 4, "final", 1, 12, 4, "final", 2, 0, 4, "final", 3, 0, 4]];
const expectedContents: number[][] = [[], [0], [11, 0, 0], [11, 12, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size + 2, { maxByteLength: (size + 2) * 2 });
  const parent: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  const holder: LengthViewHolder = { view: parent.subarray(1, size + 1) };
  for (let index = 0; index < size; index++) holder.view[index] = 11 + index;
  const limit = holder.view.length;
  for (let index = 0; index <= limit; index++) {
    const value: number | undefined = holder.view[index]; log.push("read", index, value, holder.view.length);
    if (index === 0) { buffer.resize(1 + Math.floor(limit / 2)); log.push("shrink", buffer.byteLength, holder.view.length); }
    if (index === limit) { buffer.resize((limit + 2) * 2); log.push("regrow", buffer.byteLength, holder.view.length); }
  }
  const contents: number[] = [];
  for (let index = 0; index < holder.view.length; index++) {
    const value = holder.view[index]; log.push("final", index, value, holder.view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(holder.view.length, expectedContents[shape].length);
}
