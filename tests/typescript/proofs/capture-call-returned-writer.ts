/*---
description: A returned wrapper invokes a writer of the original captured binding.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-function-types]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: a returned closure calls the original writer; node reads the updated binding.
function wrap(write: (value: number) => void, n: number): () => void {
  return () => write(n);
}
function afterWrite(n: number): number {
  let value = 0;
  const read = (): number => value;
  const write = (next: number): void => { value = next; };
  const returned = wrap(write, n);
  returned();
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterWrite(n), n);
