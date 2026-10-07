// expect: emit-c --rc -> `createElement` on an opaque C pointer, which has no method table here is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a call the checker resolves to lib.dom.d.ts's own overload (`createElement<K>`, `setAttribute`) lowers as the bound method of the same name at the call's arity, its lib.dom result type the bound handle.
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
