/*---
description: Delayed readers retain the body write to each for-of iteration binding.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: Body writes end the copied-capture fact; node returns 10 + delta, 20 + delta, and 30 + delta from separate cells.
function delayedReaders(delta: number): (() => number)[] {
  const readers: (() => number)[] = [];
  for (let value of [10, 20, 30]) {
    const read = (): number => value;
    readers.push(read);
    value += delta;
  }
  return readers;
}
for (const delta of [-1, 0, 1, 3, 7]) {
  const readers = delayedReaders(delta);
  assert.sameValue(readers.length, 3);
  assert.sameValue(readers[0](), 10 + delta);
  assert.sameValue(readers[1](), 20 + delta);
  assert.sameValue(readers[2](), 30 + delta);
}
