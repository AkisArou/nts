/*---
description: A continue edge carries a shifted array to the next iteration's formerly in-bounds read.
features: [ts-proof-bounds, ts-route-loop, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 starts below the literal's length.
// A shift before continue removes that slot; node's next read gives undefined.
function readAfterContinue(skip: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let result: number | undefined = 44;
  for (let turn = 0; turn < 3; turn++) {
    if (turn === skip) {
      xs.shift();
      continue;
    }
    result = xs[3];
  }
  return result;
}

for (const skip of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(readAfterContinue(skip), skip === 0 || skip === 1 ? undefined : 44);
}
