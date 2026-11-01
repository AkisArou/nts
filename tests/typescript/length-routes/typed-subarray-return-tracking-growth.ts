/*---
description: An omitted-end subarray returned with a typed view signature remains length tracking while a live-bound traversal doubles its parent buffer.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-functions, ts-typed-array-views]
---*/
// A returned subarray omits its end; node includes the new zero-filled tail when the loop doubles the tracking extent.
type LengthTrace = (string | number | undefined)[];
function returnTrackingTail(view: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> { return view.subarray(1); }
const expectedLogs: LengthTrace[] = [[], ["read", 0, 20, 1, "resize", 3, 2, "read", 1, 0, 2, "final", 0, 20, 2, "final", 1, 0, 2], ["read", 0, 20, 3, "resize", 7, 6, "read", 1, 21, 6, "read", 2, 22, 6, "read", 3, 0, 6, "read", 4, 0, 6, "read", 5, 0, 6, "final", 0, 20, 6, "final", 1, 21, 6, "final", 2, 22, 6, "final", 3, 0, 6, "final", 4, 0, 6, "final", 5, 0, 6], ["read", 0, 20, 4, "resize", 9, 8, "read", 1, 21, 8, "read", 2, 22, 8, "read", 3, 23, 8, "read", 4, 0, 8, "read", 5, 0, 8, "read", 6, 0, 8, "read", 7, 0, 8, "final", 0, 20, 8, "final", 1, 21, 8, "final", 2, 22, 8, "final", 3, 23, 8, "final", 4, 0, 8, "final", 5, 0, 8, "final", 6, 0, 8, "final", 7, 0, 8]];
const expectedContents: number[][] = [[], [20, 0], [20, 21, 22, 0, 0, 0], [20, 21, 22, 23, 0, 0, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size + 1, { maxByteLength: size * 2 + 1 });
  const view: Uint8Array<ArrayBuffer> = returnTrackingTail(new Uint8Array(buffer));
  for (let index = 0; index < size; index++) view[index] = 20 + index;
  const initial = view.length;
  for (let index = 0; index < view.length; index++) {
    const value: number | undefined = view[index]; log.push("read", index, value, view.length);
    if (index === 0) { buffer.resize(initial * 2 + 1); log.push("resize", buffer.byteLength, view.length); }
  }
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
