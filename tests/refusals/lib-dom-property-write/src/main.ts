// expect: emit-c --rc -> emits-c nts_dom_Element_set_scrollTop(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a write
// of a lib.dom.d.ts property on a bound type goes through the bound property's
// `@ntsSet` -- `div.id = "main"` is `_set_id` -- and a compound one reads it
// through its `@ntsGet` first: `div.scrollTop += 5` is `_get_scrollTop`, then
// `_set_scrollTop`.
//
// **Kept as a guard from the day it was written (2026-10-07)**: found by
// MainClaude while building the compiler half; the first six fixtures read
// properties and none wrote one. Its `go` makes the control's calls in the
// control's order.
//
// Control, one difference: the same program against the generated nts:dom
// module, which compiles today (emit-c --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const div = document().createElement("div");
//       div.id = "main";
//       div.scrollTop += 5;
//       return div.scrollTop;
//     }

export function go(): number {
  const div = document.createElement("div");
  div.id = "main";
  div.scrollTop += 5;
  return div.scrollTop;
}
