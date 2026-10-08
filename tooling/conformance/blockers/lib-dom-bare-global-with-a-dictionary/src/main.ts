// expect: emit-c --rc -> emits-c nts_dom_Window_fetch_2(
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
//
// **A guard since 2026-10-08** (MainClaude): a native slot decides what its
// argument is (`native_slot`) -- a string for a string slot, and the record
// for one C takes by value, which the literal is copied into.
export function start(url: string): void {
  fetch(url, { keepalive: true });
}
