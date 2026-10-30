/*---
description: Index starts at 0; the labelled exit carries 4, giving undefined.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is inside the four-element literal before the loop.
// Index starts at 0; the labelled exit carries 4, giving undefined.
function read(stop: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let index = 0;
  outer: for (let turn = 0; turn < 4; turn++) {
    for (let step = 0; step < 2; step++) {
      if (turn === stop) { index = 4; break outer; }
    }
  }
  return xs[index];
}
for (const stop of [-1, 0, 2, 3, 4, 7]) {
  assert.sameValue(read(stop), stop >= 0 && stop < 4 ? undefined : 11);
}
