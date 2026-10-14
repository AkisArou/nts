// expect: emit-c --rc -> emits-c nts_dom_Window_getComputedStyle_1(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// lib.dom global no binding names by itself is a property of the global
// object, as page script's `location` is `window.location` -- read from what
// `window`'s binding answers where the type implementing it declares the
// member, a call for a method (`getComputedStyle(el)`). Only a name lib.dom
// declares: a program's own global is never taken for one. And `window`, whose
// lib.dom type is `Window & typeof globalThis`, is its `Window` part's handle.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// for the Chromium lane's apps: `history.scrollRestoration` was "a global
// member with no definition here", and `getComputedStyle` "a builtin this
// compiler does not provide".
//
// Control, one difference: the same program against the generated nts:dom
// module, through `window()` by name (emit-c --rc, clean):
//
//     import { document, window } from "nts:dom";
//     export function go(): number {
//       const style = window().getComputedStyle(document().createElement("div"));
//       const narrow = window().matchMedia("(max-width: 600px)").matches ? 1 : 0;
//       window().history.scrollRestoration = "manual";
//       return window().innerWidth + window().innerHeight + window().location.href.length + style.color.length + narrow;
//     }

export function go(): number {
  const style = getComputedStyle(document.createElement("div"));
  const narrow = matchMedia("(max-width: 600px)").matches ? 1 : 0;
  history.scrollRestoration = "manual";
  return innerWidth + window.innerHeight + location.href.length + style.color.length + narrow;
}
