/*---
description: A field-held view is detached during a saved-bound scan, making later reads undefined and leaving every ignored write out of the transferred bytes.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects, ts-unions]
---*/
// A Uint8Array field is transferred after its first indexed read; node returns undefined for the old view and preserves the destination bytes.
type LengthTrace = (string | number | undefined)[];
interface LengthViewHolder { view: Uint8Array<ArrayBuffer>; }
const expectedLogs: LengthTrace[] = [["before", 0, undefined, 0, "transfer", 0, 0, "write", 0, 80, 0, "after", 0, undefined, 0], ["before", 0, 10, 1, "transfer", 2, 0, "write", 0, 80, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "write", 1, 81, 0, "after", 1, undefined, 0, "moved", 0, 10, 2, "moved", 1, 0, 2], ["before", 0, 10, 3, "transfer", 6, 0, "write", 0, 80, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "write", 1, 81, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "write", 2, 82, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "write", 3, 83, 0, "after", 3, undefined, 0, "moved", 0, 10, 6, "moved", 1, 11, 6, "moved", 2, 12, 6, "moved", 3, 0, 6, "moved", 4, 0, 6, "moved", 5, 0, 6], ["before", 0, 10, 4, "transfer", 8, 0, "write", 0, 80, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "write", 1, 81, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "write", 2, 82, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "write", 3, 83, 0, "after", 3, undefined, 0, "before", 4, undefined, 0, "write", 4, 84, 0, "after", 4, undefined, 0, "moved", 0, 10, 8, "moved", 1, 11, 8, "moved", 2, 12, 8, "moved", 3, 13, 8, "moved", 4, 0, 8, "moved", 5, 0, 8, "moved", 6, 0, 8, "moved", 7, 0, 8]];
const expectedContents: number[][] = [[], [], [], []];
const expectedMoved: number[][] = [[], [10, 0], [10, 11, 12, 0, 0, 0], [10, 11, 12, 13, 0, 0, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size, { maxByteLength: size * 2 });
  const holder: LengthViewHolder = { view: new Uint8Array(buffer) };
  for (let index = 0; index < size; index++) holder.view[index] = 10 + index;
  let moved: ArrayBuffer | undefined;
  const limit = holder.view.length;
  for (let index = 0; index <= limit; index++) {
    const before: number | undefined = holder.view[index]; log.push("before", index, before, holder.view.length);
    if (index === 0) { moved = buffer.transfer(limit * 2); log.push("transfer", moved.byteLength, holder.view.length); }
    holder.view[index] = 80 + index; log.push("write", index, 80 + index, holder.view.length);
    const after: number | undefined = holder.view[index]; log.push("after", index, after, holder.view.length);
  }
  if (moved === undefined) throw new Test262Error("transfer was not reached");
  const destination: Uint8Array<ArrayBuffer> = new Uint8Array(moved); const copied: number[] = [];
  for (let index = 0; index < destination.length; index++) {
    const value = destination[index]; log.push("moved", index, value, destination.length); copied.push(value);
  }
  assert.compareArray(copied, expectedMoved[shape]); assert.sameValue(destination.length, size * 2);
  const contents: number[] = [];
  for (let index = 0; index < holder.view.length; index++) {
    const value = holder.view[index]; log.push("final", index, value, holder.view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(holder.view.length, expectedContents[shape].length);
}
