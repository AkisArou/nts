// expect: emit-c --rc -> invalid HIR: CallArgumentType { func: "start", callee: "nts_dom_Window_fetch_2", at: 2
//
// A bare lib.dom global (550a0ad2f routes it to the window binding) given a
// dictionary argument -- `fetch(url, { keepalive: true })`, any member --
// passes the object literal as a managed object where the binding takes
// the native struct: invalid HIR, nothing emitted. The same call through
// `window.fetch`, and a dictionary to a constructor (`new Request(url,
// { method })`), compile. Found 2026-10-08 by the Chromium lane.
//
// Control (emit-c --rc), one difference -- `window.fetch(url, {...})`:
// nothing refused.
export function start(url: string): void {
  fetch(url, { keepalive: true });
}
