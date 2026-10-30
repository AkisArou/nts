/*---
description: Suspension effects on an Int32Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures, ts-async, ts-arrow-functions]
flags: [async]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the suspension route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads -123456789 + (-7 - change) after the change, otherwise -123456789.
async function read(change: number): Promise<number> {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  let view = new Int32Array(buffer, 4, 3);
  const index = 2;
  view[index] = -123456789;
  if (index < view.length) {
    const changed = Promise.resolve().then(() => {
      if (change > 0) {
        const moved = buffer.transfer(20);
        view = new Int32Array(moved, 4, 3);
        view[index] += -7 - change;
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
    assert.sameValue(result, change > 0 ? -123456789 + (-7 - change) : -123456789);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
