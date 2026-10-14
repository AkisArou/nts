// expect: emit-c --rc -> emits-c nts_dom_EventTargetSequence_item(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// method lib.dom types as answering an array -- `event.composedPath():
// EventTarget[]` -- whose binding answers a sequence (`EventTargetSequence`,
// `length` and `item`) is a new array of the sequence's items, as WebIDL
// converts a `sequence<T>` to a new JavaScript array each time: page
// script's `composedPath()` is a fresh array too. Each item is retained as the
// array keeps it.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// for the Chromium lane's apps.
//
// Control, one difference: the same program against the generated nts:dom
// module, copying the sequence by hand (emit-c --rc, clean):
//
//     import { document, type Event, type EventTarget } from "nts:dom";
//     export function go(): number {
//       const state = { n: 0 };
//       document().addEventListener("click", (event: Event) => {
//         const sequence = event.composedPath();
//         const path: EventTarget[] = [];
//         for (let i = 0; i < sequence.length; i++) {
//           const target = sequence.item(i);
//           if (target !== null) path.push(target);
//         }
//         state.n += path.length;
//       });
//       return state.n;
//     }

export function go(): number {
  const state = { n: 0 };
  document.addEventListener("click", (event: Event) => {
    const path = event.composedPath();
    state.n += path.length;
  });
  return state.n;
}
