// expect: emit-c --rc -> once-c nts_guarded_nts_dom_release((void *)
//
// **FIXED 2026-10-07, and kept as a guard**: a parameter the function keeps is
// released where it dies, after the loop. It was counted beside the closure's
// capture -- two release call sites, `duplicates-c` -- until 2026-10-22, when a
// closure nothing reads stopped being made (dead-code elimination), and with
// it the capture that made `each` keep `d` at all. So `make` is now kept in a
// module variable: `each` keeps `d` through it, the capture is given back by
// the closure's own release, and the one call site left in `each` is the
// parameter's. `once-c` holds it: none means that release is gone again. The
// record follows unchanged.
//
// A host handle parameter the callee owns -- `each` captures `d` in a
// closure, so its caller retains `d` before each call -- is never released
// when its last use is inside a loop. `go` retains twice and nothing gives
// either back: the only release call in the file is the closure's capture.
// Found 2026-10-06 in the browser: the Chromium DOM witness's
// `for (const seed of seeds) fuzz(d, ...)` left the document rooted
// (NTS_DOM_ROOT HTMLDocument x1), where one straight-line call had not. The
// same holds for an indexed `for` and a `while`. Under NoGc nothing counts;
// under RC each call leaks one root of whatever the handle is.
//
// Control, one difference -- the loop replaced by its body: `touch(d, 1);`.
// The parameter's release follows the call (one release call site, the
// parameter's), and retains and releases balance.
//
// Fixed, the loop form has two release call sites -- the closure's and the
// parameter's after the loop -- and this expectation goes red: the checker
// has no form for "retains outnumber releases", so `once-c` asserts today's
// single release site, and a red here means update it to the fixed count.

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
