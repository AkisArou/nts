/*---
description: Transfer on the first mandatory iteration makes index 0 undefined.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before a mandatory iteration.
// Transfer on the first mandatory iteration makes index 0 undefined.
function read(turns: number, detach: boolean): number | undefined {
  const buffer = new ArrayBuffer(8);
  const view = new Int32Array(buffer);
  view[0] = 17;
  const index = 0;
  if (index < view.length) {
    let turn = 0;
    do {
      if (turn === 0 && detach) buffer.transfer();
      turn++;
    } while (turn < turns);
    return view[index];
  }
  return -1;
}
for (const turns of [0, 1, 3]) for (const detach of [false, true]) {
  assert.sameValue(read(turns, detach), detach ? undefined : 17);
}
