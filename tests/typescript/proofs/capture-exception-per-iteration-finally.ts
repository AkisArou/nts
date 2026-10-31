/*---
description: Caught throws and finally writes preserve the distinct bindings of delayed iteration readers.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-errors, ts-objects]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: The throw preserves a partial write before finally; node adds twice delta on that path and delta otherwise.
function delayedReaders(delta: number): (() => number)[] {
  const readers: (() => number)[] = [];
  for (let value of [10, 20, 30]) {
    readers.push(() => value);
    try {
      if (delta > 0) {
        value += delta;
        throw new Error("retain body write");
      }
    } catch {
    } finally {
      value += delta;
    }
  }
  return readers;
}
for (const sample of [
  { delta: -1, offset: -1 }, { delta: 0, offset: 0 },
  { delta: 1, offset: 2 }, { delta: 3, offset: 6 }, { delta: 7, offset: 14 }
]) {
  const readers = delayedReaders(sample.delta);
  assert.sameValue(readers.length, 3);
  assert.sameValue(readers[0](), 10 + sample.offset);
  assert.sameValue(readers[1](), 20 + sample.offset);
  assert.sameValue(readers[2](), 30 + sample.offset);
}
