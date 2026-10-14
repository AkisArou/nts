// expect: emit-c --rc -> emits-c nts_dom_Window_alert_1(
//
// A bare lib.dom global the global object's binding implements, in a program
// that never writes `window`, whose lib.dom parameter is wider than the
// binding's -- `alert(message?: any)` against `alert(message: StringView)`.
// Two defects stood in front of it, and `fetch(url)` hit both (the Chromium
// lane's lib-dom-global-fetch-is-taken-as-a-builtin):
//
// - The global object's binding was found through the symbol table, and a
//   `declare var window` the program never names has no symbol: "`alert`, a
//   builtin this compiler does not provide", until something read `window`.
//   It is found by its declaration's name now (`ModuleScope::global_object`).
// - The argument was lowered expecting lib.dom's `any`, erased, and refused at
//   the binding's string slot as "a value that is not a string". A native
//   string slot now decides what its argument is lowered as
//   (`native_string_slot`).
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude.
//
// Not in this program, deliberately: any read of `window` hides the first
// defect. Its control is `window.alert("x")`, which compiled on main because
// the checker resolves it to the binding's own overload; the emitted call is
// `nts_dom_Window_alert_1` either way.
export function bare(): number {
  alert("hello");
  return 1;
}
