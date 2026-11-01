/*---
description: Control for typed-offset-closure-shrink-recovery; one local view uses a fresh bounds check immediately before each indexed observation.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined]
---*/
// Control: one local view is checked after each resize or transfer, with no call or alias between the fresh bound and the access.
type LengthTrace = (string | number | undefined)[];
const expectedLogs: LengthTrace[] = [["shrink", 1, 0, 0, "read", 0, undefined, 0, 0, "regrow", 2, 0, 2, "read", 1, undefined, 0, 2], ["shrink", 1, 0, 0, "read", 0, undefined, 0, 0, "regrow", 6, 2, 2, "read", 1, 0, 2, 2, "read", 2, undefined, 2, 2, "final", 0, 0, 2, "final", 1, 0, 2], ["shrink", 1, 0, 0, "read", 0, undefined, 0, 0, "regrow", 14, 6, 2, "read", 1, 0, 6, 2, "read", 2, 0, 6, 2, "read", 3, 0, 6, 2, "read", 4, 0, 6, 2, "final", 0, 0, 6, "final", 1, 0, 6, "final", 2, 0, 6, "final", 3, 0, 6, "final", 4, 0, 6, "final", 5, 0, 6], ["shrink", 1, 0, 0, "read", 0, undefined, 0, 0, "regrow", 18, 8, 2, "read", 1, 0, 8, 2, "read", 2, 0, 8, 2, "read", 3, 0, 8, 2, "read", 4, 0, 8, 2, "read", 5, 0, 8, 2, "final", 0, 0, 8, "final", 1, 0, 8, "final", 2, 0, 8, "final", 3, 0, 8, "final", 4, 0, 8, "final", 5, 0, 8, "final", 6, 0, 8, "final", 7, 0, 8]];
const expectedContents: number[][] = [[], [0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(2 + size * 2, { maxByteLength: 2 + size * 4 });
  const view: Uint16Array<ArrayBuffer> = new Uint16Array(buffer, 2);
  for (let index = 0; index < size; index++) view[index] = 10 + index;
  const limit = size;
  for (let index = 0; index <= limit + 1; index++) {
    if (index === 0) { buffer.resize(1); log.push("shrink", buffer.byteLength, view.length, view.byteOffset); }
    if (index === 1) { buffer.resize(2 + limit * 4); log.push("regrow", buffer.byteLength, view.length, view.byteOffset); }
    const current = view.length; const value: number | undefined = index < current ? view[index] : undefined;
    log.push("read", index, value, current, view.byteOffset);
  }
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
