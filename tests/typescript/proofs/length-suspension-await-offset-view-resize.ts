/*---
description: An awaited resize can move a tracking view offset beyond the new buffer end.
features: [ts-proof-length, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-async, ts-numbers]
flags: [async]
---*/
// Fact: the guarded view length is 4 (docs/foundations/objects.md, Typed arrays).
// Route: a microtask shrinks below offset 4; node reads 0 instead of length 4.
async function offsetLengthAfterAwait(bytes: number): Promise<number> {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Uint8Array(buffer, 4);
  const pending = Promise.resolve().then(() => buffer.resize(bytes));
  if (view.length !== 4) return -1;
  await pending;
  return view.length;
}
async function check(): Promise<void> {
  for (const n of [0, 1, 3, 4, 7, 8]) {
    const result = await offsetLengthAfterAwait(n);
    assert.sameValue(result, n < 4 ? 0 : n - 4);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
