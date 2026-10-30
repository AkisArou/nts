/*---
description: Builtin callbacks update the iteration binding retained by an earlier reader.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: The two callbacks write the loop binding; node reads each starting value plus three times delta.
function delayedReaders(delta: number): (() => number)[] {
  const readers: (() => number)[] = [];
  for (let value of [10, 20, 30]) {
    readers.push(() => value);
    [1, 2].forEach(multiplier => { value += multiplier * delta; });
  }
  return readers;
}
for (const delta of [-1, 0, 1, 3, 7]) {
  const readers = delayedReaders(delta);
  assert.sameValue(readers.length, 3);
  assert.sameValue(readers[0](), 10 + 3 * delta);
  assert.sameValue(readers[1](), 20 + 3 * delta);
  assert.sameValue(readers[2](), 30 + 3 * delta);
}
