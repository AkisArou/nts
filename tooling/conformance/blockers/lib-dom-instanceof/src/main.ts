// expect: emit-c --rc -> a call result of unrepresentable type (a union of `ChildNode` | null) is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): `x instanceof HTMLElement` against a bound lib.dom.d.ts class value lowers to `nts_dom_is(x, id)` with the overlay's `@ntsIs` id, and narrows.
// Filed 2026-10-06 by the Chromium lane with the compiler lane's agreed
// design; one of six. Today every one refuses at the first thing they share
// -- a lib.dom.d.ts type is no native representation until the Bindings
// table maps it -- so each moves to its own refusal as the table lands, and
// goes clean with its own piece.
//
// **Moved 2026-10-07**: the type now has its representation (`bound_types`),
// so this stops at its own piece. Next: lib.dom types `firstChild` as
// `ChildNode | null`, a mixin no binding implements, where `nts:dom` answers
// `Node | null`.
//
// Control, one difference: the same program against the generated nts:dom
// module the overlay names, which compiles today (emit-c --napi --rc, clean):
//
//     import { asHTMLElement, document } from "nts:dom";
//     export function go(): number {
//       const first = document().firstChild;
//       return first !== null && asHTMLElement(first) !== null ? 1 : 0;
//     }

export function go(): number {
  const first = document.firstChild;
  return first instanceof HTMLElement ? 1 : 0;
}
