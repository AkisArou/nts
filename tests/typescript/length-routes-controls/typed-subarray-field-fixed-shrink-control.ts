/*---
description: Control for typed-subarray-field-fixed-shrink; one local view uses a fresh bounds check immediately before each indexed observation.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined]
---*/
// Control: one local view is checked after each resize or transfer, with no call or alias between the fresh bound and the access.
type LengthTrace = (string | number | undefined)[];
const expectedLogs: LengthTrace[] = [["read", 0, undefined, 0, "shrink", 1, 0, "regrow", 4, 0], ["read", 0, 11, 1, "shrink", 1, 0, "read", 1, undefined, 0, "regrow", 6, 1, "final", 0, 0, 1], ["read", 0, 11, 3, "shrink", 2, 0, "read", 1, undefined, 0, "read", 2, undefined, 0, "read", 3, undefined, 0, "regrow", 10, 3, "final", 0, 11, 3, "final", 1, 0, 3, "final", 2, 0, 3], ["read", 0, 11, 4, "shrink", 3, 0, "read", 1, undefined, 0, "read", 2, undefined, 0, "read", 3, undefined, 0, "read", 4, undefined, 0, "regrow", 12, 4, "final", 0, 11, 4, "final", 1, 12, 4, "final", 2, 0, 4, "final", 3, 0, 4]];
const expectedContents: number[][] = [[], [0], [11, 0, 0], [11, 12, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size + 2, { maxByteLength: (size + 2) * 2 });
  const view: Uint8Array<ArrayBuffer> = new Uint8Array(buffer, 1, size);
  for (let index = 0; index < size; index++) view[index] = 11 + index;
  const limit = size;
  for (let index = 0; index <= limit; index++) {
    const current = view.length; const value: number | undefined = index < current ? view[index] : undefined;
    log.push("read", index, value, current);
    if (index === 0) { buffer.resize(1 + Math.floor(limit / 2)); log.push("shrink", buffer.byteLength, view.length); }
    if (index === limit) { buffer.resize((limit + 2) * 2); log.push("regrow", buffer.byteLength, view.length); }
  }
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
