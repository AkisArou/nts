/*---
description: Control for typed-tracking-field-cached-shrink; one local view uses a fresh bounds check immediately before each indexed observation.
features: [ts-length-route-typed-arrays, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined]
---*/
// Control: one local view is checked after each resize or transfer, with no call or alias between the fresh bound and the access.
type LengthTrace = (string | number | undefined)[];
const expectedLogs: LengthTrace[] = [[], ["read", 0, 10, 1, "resize", 0, 0], ["read", 0, 10, 3, "resize", 1, 1, "read", 1, undefined, 1, "read", 2, undefined, 1, "final", 0, 10, 1], ["read", 0, 10, 4, "resize", 2, 2, "read", 1, 11, 2, "read", 2, undefined, 2, "read", 3, undefined, 2, "final", 0, 10, 2, "final", 1, 11, 2]];
const expectedContents: number[][] = [[], [], [10], [10, 11]];
for (const shape of [0, 1, 2, 3]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const log: LengthTrace = [];
  const buffer = new ArrayBuffer(size, { maxByteLength: size * 2 });
  const view: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  for (let index = 0; index < size; index++) view[index] = 10 + index;
  const limit = size;
  for (let index = 0; index < limit; index++) {
    const current = view.length; const value: number | undefined = index < current ? view[index] : undefined;
    log.push("read", index, value, current);
    if (index === 0) { buffer.resize(Math.floor(limit / 2)); log.push("resize", buffer.byteLength, view.length); }
  }
  const contents: number[] = [];
  for (let index = 0; index < view.length; index++) {
    const value = view[index]; log.push("final", index, value, view.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[shape]); assert.compareArray(contents, expectedContents[shape]);
  assert.sameValue(view.length, expectedContents[shape].length);
}
