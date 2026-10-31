/*---
description: A labelled break retains the current outer iteration binding after its inner-loop write.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-objects]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: The labelled exit retains the written cells; node reads [12, 21] for delta 1 and [10, 20, 30] for delta 0.
function delayedReaders(delta: number): (() => number)[] {
  const readers: (() => number)[] = [];
  collect: for (let value of [10, 20, 30]) {
    readers.push(() => value);
    for (const turn of [0, 1]) {
      value += delta;
      if (delta > 0 && turn === 0 && readers.length === 2) break collect;
    }
  }
  return readers;
}
for (const sample of [
  { delta: -1, expected: [8, 18, 28] },
  { delta: 0, expected: [10, 20, 30] },
  { delta: 1, expected: [12, 21] },
  { delta: 3, expected: [16, 23] },
  { delta: 7, expected: [24, 27] }
]) {
  const readers = delayedReaders(sample.delta);
  assert.sameValue(readers.length, sample.expected.length);
  for (let index = 0; index < sample.expected.length; index++) {
    assert.sameValue(readers[index](), sample.expected[index]);
  }
}
