// expect: emit-c --rc -> emits-c nts_dom_Node_get_childNodes(
//
// **FIXED 2026-10-07, and kept as a guard**: the refusal is asked only where a
// signature reads the handle as another representation, which takes the
// closure's erased entry as an adapter; `pick()` reads it as `Node`, as the
// closure answers it, and calls the closure's typed entry. The guard reads the
// property access after the call, which `go` reaches only when it lowers. The
// record follows unchanged.
//
//
// A local closure answering a host handle, called directly --
// `const pick = (): Node => pool[i]; pick().childNodes` -- is refused since a2
// (7a5964d71), which fixed the opposite case (a handle-returning closure passed
// where `() => void` is taken, a-handle-returning-closure-called-as-void). The
// closure is not passed anywhere; its own call reads the result. The compiler
// before a2 (717f5d4e3) compiled this, and the Chromium lane's DOM fuzz ran on
// it. Found 2026-10-07 rebuilding the lane on a2: `fuzz` in
// runtime/chromium/tests/idl-vectors.ts (`const pick = (): Node => ...`).
//
// Control, one difference -- the closure answers a number:
//
//     const pick = (): number => pool.length;
//     return pick();
//
// compiles on a2.

import { document } from "nts:dom";
import type { Node } from "nts:dom";
export function go(): number {
  const pool: Node[] = [document()];
  const pick = (): Node => pool[0];
  return pick().childNodes.length;
}
