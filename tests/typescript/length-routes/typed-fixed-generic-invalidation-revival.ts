/*---
description: A generic fixed view is wholly invalidated during a cached index scan and later revives with the truncated tail zeroed.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-functions, ts-generics, ts-generic-constraints]
---*/
// A fixed Uint8Array crosses a generic scan; node invalidates the whole view, then resumes valid reads after buffer regrowth.
type LengthTrace = (string | number | undefined)[];
function scanFixedView<T extends Uint8Array<ArrayBuffer>>(view: T, buffer: ArrayBuffer, log: LengthTrace): void {
  const limit = view.length;
  for (let index = 0; index <= limit; index++) {
    const before: number | undefined = view[index]; log.push("before", index, before, view.length);
    if (index === 0) { buffer.resize(Math.floor(limit / 2)); log.push("shrink", buffer.byteLength, view.length); }
    if (index === Math.ceil(limit / 2)) { buffer.resize(limit * 2); log.push("regrow", buffer.byteLength, view.length); }
    const after: number | undefined = view[index]; log.push("after", index, after, view.length);
  }
}
const expectedLogs: LengthTrace[] = [["before", 0, undefined, 0, "shrink", 0, 0, "regrow", 0, 0, "after", 0, undefined, 0], ["before", 0, 10, 1, "shrink", 0, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "regrow", 2, 1, "after", 1, undefined, 1, "final", 0, 0, 1], ["before", 0, 10, 3, "shrink", 1, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "regrow", 6, 3, "after", 2, 0, 3, "before", 3, undefined, 3, "after", 3, undefined, 3, "final", 0, 10, 3, "final", 1, 0, 3, "final", 2, 0, 3], ["before", 0, 10, 4, "shrink", 2, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "regrow", 8, 4, "after", 2, 0, 4, "before", 3, 0, 4, "after", 3, 0, 4, "before", 4, undefined, 4, "after", 4, undefined, 4, "final", 0, 10, 4, "final", 1, 11, 4, "final", 2, 0, 4, "final", 3, 0, 4]];
const expectedContents: number[][] = [[], [0], [10, 0, 0], [10, 11, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size, { maxByteLength: size * 2 });
  const view: Uint8Array<ArrayBuffer> = new Uint8Array(buffer, 0, size);
  for (let index = 0; index < size; index++) view[index] = 10 + index;
  scanFixedView(view, buffer, log);
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
