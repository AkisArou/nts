// expect: emit-c --rc -> emits-c nts_dom_NodeList_item(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// `for...of` over a collection a binding implements -- `querySelectorAll`'s
// `NodeListOf<HTMLLIElement>`, bound through its generic's overlay entry to
// `NodeList` -- is `item(i)` while `i < length`, the length read again each
// turn as `%Array.prototype.values%` reads an array-like's, so a list the body
// changes is seen changed. Each item is read as the loop variable's lib.dom
// type: what the selector's tag says the list holds, as an event map says what
// a listener is passed.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// for the Chromium lane's apps: it was "a call result of unrepresentable type
// (`NodeListOf`)".
//
// Control, one difference: the same loop against the generated nts:dom
// module, which declares no iteration and is walked by hand (emit-c --rc,
// clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const items = document().querySelectorAll("li");
//       let total = 0;
//       for (let i = 0; i < items.length; i++) {
//         const item = items.item(i);
//         if (item !== null) total += item.nodeType;
//       }
//       return total;
//     }

export function go(): number {
  let total = 0;
  for (const item of document.querySelectorAll("li")) {
    total += item.childElementCount;
  }
  return total;
}
