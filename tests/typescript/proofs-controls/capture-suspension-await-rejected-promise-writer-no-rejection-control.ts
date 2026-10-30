/*---
description: Control for a captured write across await; the callback fulfills without throwing.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-async, ts-errors]
flags: [async]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Paired subject: ../proofs/capture-suspension-await-rejected-promise-writer.ts.
// Only the callback throw is removed; the write and await remain.
async function afterAwait(n: number): Promise<number> {
  let value = 0;
  const read = (): number => value;
  const write = Promise.resolve().then(() => {
    value = n;
    // Control: the fulfillment callback does not reject.
  });
  try { await write; } catch {}
  return read();
}
async function main(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(await afterAwait(n), n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
