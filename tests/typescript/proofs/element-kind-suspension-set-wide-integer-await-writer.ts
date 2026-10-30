/*---
description: An awaited reaction widens a numeric Set before its async reader resumes.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-async, ts-arrow-functions, ts-closures, ts-unknown]
flags: [async]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the queued promise reaction inserts the wide value while the reader awaits it.
function read(items: Set<number>): number {
  const values = Array.from(items);
  return values[values.length - 1];
}
async function observe(n: number): Promise<number> {
  const items = new Set<number>([1, 2]);
  const pending = Promise.resolve().then(() => { if (n > 0) items.add(4294967296 + n); });
  assert.sameValue(read(items), 2);
  await pending;
  return read(items);
}
async function checkAll(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    assert.sameValue(await observe(n), n > 0 ? 4294967296 + n : 2);
  }
}
checkAll().then(() => $DONE(), (error: unknown) => $DONE(error));
