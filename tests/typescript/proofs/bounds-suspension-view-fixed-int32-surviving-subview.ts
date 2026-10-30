/*---
description: Suspension effects on an Int32Array view: the original fixed subview survives a shrink to 12 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures, ts-async, ts-arrow-functions]
flags: [async]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the suspension route.
// The original fixed subview survives a shrink to 12 bytes and reads a fresh sibling write; node reads -300 - change after the change, otherwise -123456789.
async function read(change: number): Promise<{ value: number; bytes: number }> {
  const buffer = new ArrayBuffer(32, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 4, 2);
  const index = 1;
  view[index] = -123456789;
  if (index < view.length) {
    const changed = Promise.resolve().then(() => {
      if (change > 0) {
        buffer.resize(12);
        const sibling = new Int32Array(buffer, 4, 2);
        sibling[index] = -300 - change;
      }
    });
    await changed;
    return { value: view[index], bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
async function check(): Promise<void> {
  for (const change of [-1, 0, 1, 3, 7]) {
    const result = await read(change);
    assert.sameValue(result.value, change > 0 ? -300 - change : -123456789);
    assert.sameValue(result.bytes, change > 0 ? 12 : 32);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
