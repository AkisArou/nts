/*---
description: A cached traversal bound outlives a shrink of a field-held tracking view and reads undefined for each discarded index.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects]
---*/
// A Uint8Array field is scanned to its saved length after the first body halves its buffer; node exposes every discarded read as undefined.
type LengthTrace = (string | number | undefined)[];
interface LengthViewHolder { view: Uint8Array<ArrayBuffer>; }
const expectedLogs: LengthTrace[] = [[], ["read", 0, 10, 1, "resize", 0, 0], ["read", 0, 10, 3, "resize", 1, 1, "read", 1, undefined, 1, "read", 2, undefined, 1, "final", 0, 10, 1], ["read", 0, 10, 4, "resize", 2, 2, "read", 1, 11, 2, "read", 2, undefined, 2, "read", 3, undefined, 2, "final", 0, 10, 2, "final", 1, 11, 2]];
const expectedContents: number[][] = [[], [], [10], [10, 11]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size, { maxByteLength: size * 2 });
  const holder: LengthViewHolder = { view: new Uint8Array(buffer) };
  for (let index = 0; index < size; index++) holder.view[index] = 10 + index;
  const limit = holder.view.length;
  for (let index = 0; index < limit; index++) {
    const value: number | undefined = holder.view[index]; log.push("read", index, value, holder.view.length);
    if (index === 0) { buffer.resize(Math.floor(limit / 2)); log.push("resize", buffer.byteLength, holder.view.length); }
  }
  const contents: number[] = [];
  for (let index = 0; index < holder.view.length; index++) {
    const value = holder.view[index]; log.push("final", index, value, holder.view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(holder.view.length, expectedContents[shape].length);
}
