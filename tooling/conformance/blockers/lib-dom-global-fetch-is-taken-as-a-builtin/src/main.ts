// expect: emit-c --rc -> NTS1001 `fetch`, a builtin this compiler does not provide
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
export async function load(url: string): Promise<number> {
  const response = await fetch(url);
  return response.status;
}
