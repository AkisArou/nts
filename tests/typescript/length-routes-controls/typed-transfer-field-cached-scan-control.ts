/*---
description: Control for typed-transfer-field-cached-scan; one local view uses a fresh bounds check immediately before each indexed observation.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Control: one local view is checked after each resize or transfer, with no call or alias between the fresh bound and the access.
type LengthTrace = (string | number | undefined)[];
const expectedLogs: LengthTrace[] = [["before", 0, undefined, 0, "transfer", 0, 0, "write", 0, 80, 0, "after", 0, undefined, 0], ["before", 0, 10, 1, "transfer", 2, 0, "write", 0, 80, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "write", 1, 81, 0, "after", 1, undefined, 0, "moved", 0, 10, 2, "moved", 1, 0, 2], ["before", 0, 10, 3, "transfer", 6, 0, "write", 0, 80, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "write", 1, 81, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "write", 2, 82, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "write", 3, 83, 0, "after", 3, undefined, 0, "moved", 0, 10, 6, "moved", 1, 11, 6, "moved", 2, 12, 6, "moved", 3, 0, 6, "moved", 4, 0, 6, "moved", 5, 0, 6], ["before", 0, 10, 4, "transfer", 8, 0, "write", 0, 80, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "write", 1, 81, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "write", 2, 82, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "write", 3, 83, 0, "after", 3, undefined, 0, "before", 4, undefined, 0, "write", 4, 84, 0, "after", 4, undefined, 0, "moved", 0, 10, 8, "moved", 1, 11, 8, "moved", 2, 12, 8, "moved", 3, 13, 8, "moved", 4, 0, 8, "moved", 5, 0, 8, "moved", 6, 0, 8, "moved", 7, 0, 8]];
const expectedContents: number[][] = [[], [], [], []];
const expectedMoved: number[][] = [[], [10, 0], [10, 11, 12, 0, 0, 0], [10, 11, 12, 13, 0, 0, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size, { maxByteLength: size * 2 });
  const view: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  for (let index = 0; index < size; index++) view[index] = 10 + index;
  let moved: ArrayBuffer | undefined;
  const limit = size;
  for (let index = 0; index <= limit; index++) {
    const beforeLength = view.length; const before: number | undefined = index < beforeLength ? view[index] : undefined;
    log.push("before", index, before, beforeLength);
    if (index === 0) { moved = buffer.transfer(limit * 2); log.push("transfer", moved.byteLength, view.length); }
    const writeLength = view.length; if (index < writeLength) view[index] = 80 + index;
    log.push("write", index, 80 + index, writeLength);
    const afterLength = view.length; const after: number | undefined = index < afterLength ? view[index] : undefined;
    log.push("after", index, after, afterLength);
  }
  if (moved === undefined) throw new Test262Error("transfer was not reached");
  const destination: Uint8Array<ArrayBuffer> = new Uint8Array(moved); const copied: number[] = [];
  for (let index = 0; index < destination.length; index++) {
    const value = destination[index]; log.push("moved", index, value, destination.length); copied.push(value);
  }
  assert.compareArray(copied, expectedMoved[shape]); assert.sameValue(destination.length, size * 2);
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
