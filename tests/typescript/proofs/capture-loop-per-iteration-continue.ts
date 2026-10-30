/*---
description: Continue preserves the body write in the selected iteration closure.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-objects]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: Continue skips the other write; node adds delta at the selected 20 and twice delta at the other iterations.
function delayedReaders(delta: number): (() => number)[] {
  const readers: (() => number)[] = [];
  for (let value of [10, 20, 30]) {
    readers.push(() => value);
    if (value === 20 && delta > 0) {
      value += delta;
      continue;
    }
    value += 2 * delta;
  }
  return readers;
}
for (const sample of [
  { delta: -1, expected: [8, 18, 28] },
  { delta: 0, expected: [10, 20, 30] },
  { delta: 1, expected: [12, 21, 32] },
  { delta: 3, expected: [16, 23, 36] },
  { delta: 7, expected: [24, 27, 44] }
]) {
  const readers = delayedReaders(sample.delta);
  assert.sameValue(readers.length, 3);
  for (let index = 0; index < sample.expected.length; index++) {
    assert.sameValue(readers[index](), sample.expected[index]);
  }
}
