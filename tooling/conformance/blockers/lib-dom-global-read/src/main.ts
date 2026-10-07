// expect: emit-c --rc -> emits-c v0 = nts_dom_document();
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a read of a lib.dom.d.ts global the overlay binds (`declare var document`) lowers as the bound nts:dom function (`document()`), and its lib.dom type is the bound handle (`Document`).
// Filed 2026-10-06 by the Chromium lane with the compiler lane's agreed
// design; one of six. Today every one refuses at the first thing they share
// -- a lib.dom.d.ts type is no native representation until the Bindings
// table maps it -- so each moves to its own refusal as the table lands, and
// goes clean with its own piece.
//
// **FIXED 2026-10-07, and kept as a guard**: lib.dom's `Document` is
// `nts:dom`'s handle (`bound_types`), and the read of `declare var document`
// is a call of the function its `@ntsBoundBy` names. The guard is the call in
// the emitted C, since running it needs Chromium's host.
//
// Control, one difference: the same program against the generated nts:dom
// module the overlay names, which compiles today (emit-c --napi --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const d = document();
//       return d === d ? 1 : 0;
//     }

export function go(): number {
  const d = document;
  return d === d ? 1 : 0;
}
