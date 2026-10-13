// expect: lacks-c nts_dom_ResizeObserverSizeSequence_item(
//
// A bound attribute lib.dom types as an array is read as if the sequence the
// binding answers were that array: `entry.contentBoxSize` --
// `ReadonlyArray<ResizeObserverSize>` in lib.dom, a `FrozenArray` nts:dom
// answers as `ResizeObserverSizeSequence` -- is cast to `NtsArray *` in
// program.c, retained, its length read from the Blink object's memory, and
// indexed. Nothing is refused; the program reads garbage or crashes. The
// Chromium lane's vectors crashed the renderer this way (SIGSEGV in
// nts_array_join_str) on `new DataTransfer().types.join(",")`. A *method*
// answering a sequence is copied into a new array through `item`
// (lib-dom-sequence-as-an-array: `event.composedPath()`); an attribute's
// read never reaches that copy. Found 2026-10-13 by the Chromium lane, which
// leaves string-sequence attributes (`navigator.languages`,
// `dataTransfer.types`) unbound until it is fixed: bound, each would turn a
// refusal into this.
//
// Control, one difference: the same program against the generated nts:dom
// module, copying the sequence by hand (emit-c --rc, clean, two `item`
// walks and no `NtsArray *` cast):
//
//     import { document, newResizeObserver, type ResizeObserver,
//              type ResizeObserverEntrySequence } from "nts:dom";
//     export function go(): number {
//       const state = { width: 0 };
//       const observer = newResizeObserver((entries: ResizeObserverEntrySequence,
//                                           observer: ResizeObserver): void => {
//         const entry = entries.item(0);
//         if (entry === null) return;
//         const sizes = entry.contentBoxSize;
//         const first = sizes.item(0);
//         if (first !== null) state.width = sizes.length + first.inlineSize;
//       });
//       const body = document().body;
//       if (body !== null) observer.observe(body);
//       return state.width;
//     }
export function go(): number {
  const state = { width: 0 };
  const observer = new ResizeObserver((entries: ResizeObserverEntry[]): void => {
    const sizes = entries[0].contentBoxSize;
    state.width = sizes.length + sizes[0].inlineSize;
  });
  const body = document.body;
  if (body !== null) observer.observe(body);
  return state.width;
}
