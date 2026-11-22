// expect: emit-c --rc -> once-c ((void *)__nts_v0);
// #900: ~/.cache/nts-scratch/900/foreign-handle-boundary/; main program.c SHA-256 b68830611ea445de8aa0ca280d007834e2ec834cfffea436cebcfea1e4af6d4e; candidate program.c SHA-256 3417e6852fce2f77320bdbd94c8f864a59e95a75b857907fb20d468f533a532f.
//
// Under resumable roots, `each` borrows its handle across the potentially
// raising loop. Its closure still takes and releases its own foreign root.
// The one cast call is that capture retain. Caller retains in `go` and a
// parameter release at the loop exit use the same cast: either addition
// breaks this count and reveals an unbalanced ownership convention.
//
// Poison and forced collection dispose 1000/1000 documents on main and the
// candidate, with identical live references after go and closure cleanup,
// and zero managed growth. The two temporary caller references of main's
// old consuming-parameter convention are no longer taken or released.
// Control: replace the loop by its body, `touch(d, 1);`.

import { document } from "nts:dom";
import type { Document } from "nts:dom";

function touch(d: Document, n: number): void {
  if (n < 0) d.createElement("p");
}
let kept: (() => void) | null = null;
function each(d: Document): number {
  const make = (): void => { d.createElement("p"); };
  kept = make;
  for (const n of [1, 2]) touch(d, n);
  return 0;
}
export function go(): number {
  const d = document();
  each(d);
  return each(d);
}
