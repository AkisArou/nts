// expect: emit-c --rc -> lacks-c nts_refused(
//
// **Fixed in a2 (7a5964d71); kept as a guard.** The closure now runs where a
// `void` signature drops its result, and no refusal stub is emitted. What
// follows is the report as filed.
//
// A closure that answers a host handle (`() => document().body`) passed where
// `() => void` is taken compiles with no diagnostic, and the call `f()` goes
// through the closure's erased entry -- which, a host handle having no erased
// form yet (runtime/chromium/contracts/compiler-requests.md section 8), is a
// stub that calls nts_refused and aborts the process when it runs. Found
// 2026-10-06 in the browser: the Chromium DOM witness aborted the renderer at
// `thrown(() => d.querySelector("["))`. A refusal belongs at compile time, or
// a void-typed call should not need the result's erased form at all.
//
// Control, one difference -- a block body, so the closure answers nothing:
// no refusal stub is emitted (emit-c --napi --rc):
//
//     run(() => { document().body; });

import { document } from "nts:dom";
function run(f: () => void): void {
  f();
}
export function go(): number {
  run(() => document().body);
  return 0;
}
