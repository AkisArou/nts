// expect: emit-c --rc -> a base `DocumentOrShadowRoot` of unrepresentable type (`DocumentOrShadowRoot`) is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a lib.dom.d.ts property read on a bound type lowers through the bound type's @ntsGet accessor of the same name.
// Filed 2026-10-06 by the Chromium lane with the compiler lane's agreed
// design; one of six. Today every one refuses at the first thing they share
// -- a lib.dom.d.ts type is no native representation until the Bindings
// table maps it -- so each moves to its own refusal as the table lands, and
// goes clean with its own piece.
//
// Control, one difference: the same program against the generated nts:dom
// module the overlay names, which compiles today (emit-c --napi --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       return document().childElementCount;
//     }

export function go(): number {
  return document.childElementCount;
}
