// expect: emit-c --rc -> emits-c nts_dom_request_idle_callback(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): an
// options dictionary a binding takes as its members -- `requestIdleCallback(f,
// { timeout: 500 })` is nts:dom's `requestIdleCallback(f, timeout)`, and
// `addEventListener(type, f, { once: true })` its `(type, f, capture, once,
// signal)` -- each member where its parameter is, and the parameter's
// `@ntsDefault` where the literal leaves it out (`capture` here). The overload
// is chosen with the members in place: `requestIdleCallback(f)` is the
// binding's other declaration.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// for the Chromium lane's apps.
//
// Control, one difference: the same program against the generated nts:dom
// module, passing the members as arguments by name (emit-c --rc, clean):
//
//     import { document, requestIdleCallback, type IdleDeadline } from "nts:dom";
//     export function go(): number {
//       const state = { n: 0 };
//       const id = requestIdleCallback((deadline: IdleDeadline) => { state.n += deadline.timeRemaining(); }, 500);
//       document().addEventListener("click", () => { state.n += 1; }, false, true);
//       return id + state.n;
//     }

export function go(): number {
  const state = { n: 0 };
  const id = requestIdleCallback((deadline: IdleDeadline) => { state.n += deadline.timeRemaining(); }, { timeout: 500 });
  document.addEventListener("click", () => { state.n += 1; }, { once: true });
  return id + state.n;
}
