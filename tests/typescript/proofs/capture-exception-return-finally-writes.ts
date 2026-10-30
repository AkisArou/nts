/*---
description: A returned reader sees the captured write performed by finally after its return is selected.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-iteration, ts-closures, ts-errors, ts-function-types]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: finally writes after choosing the returned closure; node gives that closure the latest binding.
function make(n: number): () => number {
  let value = 0;
  const read = (): number => value;
  try { return read; }
  finally { value = n; }
}
for (const n of [-1, 0, 1, 3, 7]) {
  const read = make(n);
  assert.sameValue(read(), n);
}
