// expect: emit-c --rc -> emits-c Closure0__call((NtsObj_Closure0 *)a1, (struct NtsDomMouseEvent *)a0)
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a listener typed by lib.dom.d.ts's event map (`(event: MouseEvent)`) passed where the binding's closure takes an `Event` is a trusted downcast of the same handle.
// Filed 2026-10-06 by the Chromium lane with the compiler lane's agreed
// design; one of six. Today every one refuses at the first thing they share
// -- a lib.dom.d.ts type is no native representation until the Bindings
// table maps it -- so each moves to its own refusal as the table lands, and
// goes clean with its own piece.
//
// **Compiles 2026-10-07, kept as a guard on what it does today**: the
// listener is bridged at the binding's `(event: Event)`, and the bridge casts
// the event to the `MouseEvent` its body takes -- the trusted downcast, as a C
// cast. Not yet named or checked: a pass comparing each bridge with its
// closure's parameters (a downcast along one handle's chain trusted, anything
// else refused) is the open half of this piece.
//
// Control, one difference: the same program against the generated nts:dom
// module the overlay names, which compiles today (emit-c --napi --rc, clean):
//
//     import { asMouseEvent, document } from "nts:dom";
//     import type { Event } from "nts:dom";
//     export function go(): number {
//       const state = { x: 0 };
//       document().addEventListener("click", (event: Event) => {
//         const mouse = asMouseEvent(event);
//         if (mouse !== null) state.x = mouse.clientX;
//       });
//       return state.x;
//     }

export function go(): number {
  const state = { x: 0 };
  document.addEventListener("click", (event: MouseEvent) => {
    state.x = event.clientX;
  });
  return state.x;
}
