/*---
description: A called writer shares its iteration binding with the reader saved before the call.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: The called writer updates the loop binding; node reads each starting value plus delta from its own shared cell.
function delayedReaders(delta: number): (() => number)[] {
  const readers: (() => number)[] = [];
  for (let value of [10, 20, 30]) {
    const read = (): number => value;
    const write = (): void => { value += delta; };
    readers.push(read);
    write();
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
