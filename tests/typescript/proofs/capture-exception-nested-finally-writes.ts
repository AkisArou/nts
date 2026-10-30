/*---
description: The last of two finally writes reaches the captured reader after unwinding.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-iteration, ts-closures, ts-errors]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: nested finally blocks write one shared binding; node keeps the outer final write.
function afterFinally(n: number): number {
  let value = 0;
  const read = (): number => value;
  try {
    try {
      try { throw new Error("unwind"); }
      finally { value = n; }
    } finally { value = n + 1; }
  } catch {}
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterFinally(n), n + 1);
