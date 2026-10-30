/*---
description: Suspension effects on a Float64Array view: the offset tracking view loses index 2 when its buffer shrinks to 24 bytes.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-closures, ts-async, ts-arrow-functions]
flags: [async]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the suspension route.
// The offset tracking view loses index 2 when its buffer shrinks to 24 bytes; node reads undefined after the change, otherwise -12.5.
async function read(change: number): Promise<number | undefined> {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16);
  const index = 2;
  view[index] = -12.5;
  if (index < view.length) {
    const changed = Promise.resolve().then(() => {
      if (change > 0) {
        buffer.resize(24);
      }
    });
    await changed;
    return view[index];
  }
  return -999;
}
async function check(): Promise<void> {
  for (const change of [-1, 0, 1, 3, 7]) {
    const result = await read(change);
    assert.sameValue(result, change > 0 ? undefined : -12.5);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
