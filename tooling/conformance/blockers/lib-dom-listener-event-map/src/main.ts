// expect: emit-c --rc -> `addEventListener` on an opaque C pointer, which has no method table here is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a listener typed by lib.dom.d.ts's event map (`(event: MouseEvent)`) passed where the binding's closure takes an `Event` is a trusted downcast of the same handle.
// Filed 2026-10-06 by the Chromium lane with the compiler lane's agreed
// design; one of six. Today every one refuses at the first thing they share
// -- a lib.dom.d.ts type is no native representation until the Bindings
// table maps it -- so each moves to its own refusal as the table lands, and
// goes clean with its own piece.
//
// **Moved 2026-10-07**: the type now has its representation (`bound_types`),
// so this stops at its own piece -- members and properties, step 3 of
// MainClaude's plan.
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
