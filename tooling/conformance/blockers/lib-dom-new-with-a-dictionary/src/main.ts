// expect: emit-c --rc -> emits-c nts_dom_new_Event_2(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// dictionary argument to a bound constructor -- `new Event("x", { bubbles:
// true })`, lib.dom's `EventInit` -- is the binding's `Fields<EventInit>`, a C
// struct written from the literal, its unwritten members zero, as the
// dictionary's defaults are; and a constructor with none is a call of no
// arguments (`newAbortController()`).
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// for the Chromium lane's apps.
//
// Control, one difference: the same program against the generated nts:dom
// module, calling the constructors by name (emit-c --rc, clean):
//
//     import { newAbortController, newEvent } from "nts:dom";
//     export function go(): number {
//       const event = newEvent("x", { bubbles: true });
//       const controller = newAbortController();
//       return (event.bubbles ? 1 : 0) + (controller.signal.aborted ? 1 : 0);
//     }

export function go(): number {
  const event = new Event("x", { bubbles: true });
  const controller = new AbortController();
  return (event.bubbles ? 1 : 0) + (controller.signal.aborted ? 1 : 0);
}
