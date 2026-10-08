// expect: emit-c --rc -> emits-c nts_dom_Window_fetch_1(
//
// lib.dom's global `fetch` is refused as a builtin the compiler does not
// provide, before the delegation that binds every other window global
// (setTimeout, requestAnimationFrame, localStorage) reaches it; with the
// Chromium lane's Response bound, `window.fetch(url)` compiles to
// nts_dom_Window_fetch_1. Found 2026-10-08 by the Chromium lane, binding
// fetch; until fixed its vectors call `window.fetch`.
//
// Control (emit-c --rc), one difference -- `window.fetch(url)`: nothing
// refused.
//
// **A guard since 2026-10-08** (MainClaude): the global object's binding is
// found by its declaration's name, and the argument is lowered as the string
// the binding's slot takes -- blockers/a-bare-lib-dom-global-wider-than-its-
// binding, which guards both without a fetch binding. With Response bound,
// bare `fetch(url)` is `nts_dom_Window_fetch_1(window, url)`.
export async function load(url: string): Promise<number> {
  const response = await fetch(url);
  return response.status;
}
