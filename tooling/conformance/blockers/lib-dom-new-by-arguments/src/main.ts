// expect: emit-c --rc -> emits-c nts_dom_new_URL_1(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): `new`
// of a class a binding implements is a call of the binding's constructor
// function, declared beside the type and named for it -- `new URL(...)` is
// `nts:dom`'s `newURL` -- one declaration per constructor overload and arity,
// chosen by the arguments as a delegated method's overloads are.
// `newURL(url, base)` is declared first, so a one-argument `new URL` reaching
// `nts_dom_new_URL_1` is the choice made, not the first taken.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// for the Chromium lane's apps: `new` of a bound interface was refused as "a
// `new` that does not produce an object".
//
// Control, one difference: the same program against the generated nts:dom
// module, calling the constructors by name (emit-c --rc, clean):
//
//     import { newURL } from "nts:dom";
//     export function go(): number {
//       const relative = newURL("a/b", "https://x.test/");
//       const absolute = newURL("https://y.test/p");
//       return relative.pathname.length + absolute.host.length;
//     }

export function go(): number {
  const relative = new URL("a/b", "https://x.test/");
  const absolute = new URL("https://y.test/p");
  return relative.pathname.length + absolute.host.length;
}
