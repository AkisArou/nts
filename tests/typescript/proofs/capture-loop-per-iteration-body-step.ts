/*---
description: A classic for-loop reader retains its body update but excludes the next binding update.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-objects]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: Body writes update the captured let; node keeps each body value without the next iteration binding update of two.
function delayedReaders(delta: number): (() => number)[] {
  const readers: (() => number)[] = [];
  for (let value = 0; value < 6; value += 2) {
    readers.push(() => value);
    value += delta;
  }
  return readers;
}
for (const sample of [
  { delta: -1, expected: [-1, 0, 1, 2, 3, 4] },
  { delta: 0, expected: [0, 2, 4] },
  { delta: 1, expected: [1, 4] },
  { delta: 2, expected: [2, 6] },
  { delta: 3, expected: [3, 8] }
]) {
  const readers = delayedReaders(sample.delta);
  assert.sameValue(readers.length, sample.expected.length);
  for (let index = 0; index < sample.expected.length; index++) {
    assert.sameValue(readers[index](), sample.expected[index]);
  }
}
