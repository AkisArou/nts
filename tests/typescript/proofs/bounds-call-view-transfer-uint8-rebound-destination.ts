/*---
description: Call effects on a Uint8Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures, ts-class]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the call route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads 173 + (3 + change) after the change, otherwise 173.
function read(change: number): number {
  const buffer = new ArrayBuffer(6, { maxByteLength: 10 });
  let view = new Uint8Array(buffer, 1, 3);
  const index = 2;
  view[index] = 173;
  class Updater {
    run(): void {
      if (change > 0) {
        const moved = buffer.transfer(5);
        view = new Uint8Array(moved, 1, 3);
        view[index] += 3 + change;
      }
    }
  }
  const updater = new Updater();
  if (index < view.length) {
    updater.run();
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? 173 + (3 + change) : 173);
}
