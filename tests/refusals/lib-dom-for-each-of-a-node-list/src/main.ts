// expect: emit-c --rc -> emits-c nts_dom_NodeList_item(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md):
// `forEach` of a collection a binding implements, which spells only `length`
// and `item`, is the callback's body inlined in a walk, as
// `%Array.prototype.forEach%` walks an array-like: the length read once, then
// `f(item(k), k)` for each `k` whose item is still there -- for a `NodeList`,
// whose missing items are its tail, `k` below the length read now too. The
// callback never crosses C.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// for the Chromium lane's apps: it was "`forEach` on an opaque C pointer, which
// has no method table here".
//
// Control, one difference: the same walk against the generated nts:dom
// module, written by hand (emit-c --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const items = document().querySelectorAll("li");
//       const length = items.length;
//       let total = 0;
//       for (let k = 0; k < length && k < items.length; k++) {
//         const item = items.item(k);
//         if (item !== null) total += k + item.nodeType;
//       }
//       return total;
//     }

export function go(): number {
  const state = { total: 0 };
  document.querySelectorAll("li").forEach((item, k) => {
    state.total += k + item.childElementCount;
  });
  return state.total;
}
