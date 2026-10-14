// expect: emit-c --rc -> emits-c nts_dom_is(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): `x instanceof HTMLElement` against a bound lib.dom.d.ts class value lowers to `nts_dom_is(x, id)` with the overlay's `@ntsIs` id, and narrows.
// Filed 2026-10-06 by the Chromium lane with the compiler lane's agreed
// design; one of six. Today every one refuses at the first thing they share
// -- a lib.dom.d.ts type is no native representation until the Bindings
// table maps it -- so each moves to its own refusal as the table lands, and
// goes clean with its own piece.
//
// **FIXED 2026-10-07, and kept as a guard**: `document.firstChild` is lib.dom's
// `ChildNode | null`, a mixin the Chromium lane now binds as an interface
// handle over `Node` (93756d450), which reachability resolves in depth because
// a binding names it; `instanceof HTMLElement` asks `nts_dom_is` behind a null
// test. The emitted C compiles against dom_idl.h with clang.
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
