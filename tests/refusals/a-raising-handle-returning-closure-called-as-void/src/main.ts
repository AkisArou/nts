// expect: emit-c --rc -> lacks-c nts_refused(
//
// **FIXED 2026-10-07, and kept as a guard**: the predicate that refused a
// raising copy returning a native pointer (or a `bigint`) predated
// `raised_return`'s placeholder for both, and is gone; the copy returns a null
// handle on its raising path, which no caller reads. The record follows
// unchanged.
//
// The case a2 (7a5964d71) left: a closure answering a host handle, passed
// where `() => void` is taken, whose body can raise --
// `thrown(() => document().querySelector("["))`, a SyntaxError. a2 fixed
// the non-raising case (a-handle-returning-closure-called-as-void, now a
// guard), but a call that may raise goes through the closure's raising copy,
// and that copy still compiles to a stub: "nts: refused at run time: calling
// `Closure#call` from inside a `try`, whose raising copy would have to return
// a value of a type that has none to return". It compiles with no
// diagnostic and aborts the renderer when it runs. Found 2026-10-07 on a2, in
// the Chromium DOM witness (tests/dom-witness.ts, step 4).
//
// Control, one difference -- a block body, so the closure answers nothing:
//
//     return thrown(() => { document().querySelector("["); }).length;
//
// emits no refusal stub.

import { document } from "nts:dom";
function thrown(run: () => void): string {
  try {
    run();
  } catch {
    return "caught";
  }
  return "";
}
export function go(): number {
  return thrown(() => document().querySelector("[")).length;
}
