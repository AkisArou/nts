// expect: emit-c --rc -> emits-c nts_dom_Window_fetch_2(
//
// A bare lib.dom global (550a0ad2f routes it to the window binding) given a
// dictionary argument -- `fetch(url, { method: "POST" })`, any member --
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
//
// The member was `keepalive` until 2026-10-14, when the Chromium lane bound
// the members whose presence Blink asks by spread overloads: RequestInit has
// eleven with its strings, too many to spell, so it binds as its struct,
// which carries the strings (a view says whether it was given) and not the
// boolean, and the copy into it refuses `keepalive` by name (dd2e506ae).
export function start(url: string): void {
  fetch(url, { method: "POST" });
}
