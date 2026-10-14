// expect: emit-c --rc -> emits-c nts_dom_Element_setAttribute_2(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a call the checker resolves to lib.dom.d.ts's own overload (`createElement<K>`, `setAttribute`) lowers as the bound method of the same name at the call's arity, its lib.dom result type the bound handle.
// Filed 2026-10-06 by the Chromium lane with the compiler lane's agreed
// design; one of six. Today every one refuses at the first thing they share
// -- a lib.dom.d.ts type is no native representation until the Bindings
// table maps it -- so each moves to its own refusal as the table lands, and
// goes clean with its own piece.
//
// **FIXED 2026-10-07, and kept as a guard**: each call lowers as the bound
// member of its name, with that member's arguments. The control's calls, in
// its order; lib.dom types `createElement("div")` as `HTMLDivElement`, so the
// result is cast to that handle and back, the trusted cast page script's
// typing implies.
//
// Control, one difference: the same program against the generated nts:dom
// module the overlay names, which compiles today (emit-c --napi --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const div = document().createElement("div");
//       div.setAttribute("class", "x");
//       return div.childElementCount;
//     }

export function go(): number {
  const div = document.createElement("div");
  div.setAttribute("class", "x");
  return div.childElementCount;
}
