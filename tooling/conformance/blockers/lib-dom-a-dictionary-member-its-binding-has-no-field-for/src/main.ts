// expect: emit-c --rc -> emits-c nts_dom_new_CustomEvent_2(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): an
// object literal lib.dom types as a dictionary is written into the struct
// nts:dom binds the dictionary by, and a member the struct has no field for
// is dropped without a word. CustomEventInit's `detail` is `any`, which no
// field carries (tooling/chromium/bindgen/report.json), so
// `new CustomEvent("ready", { bubbles: true, detail: 5 })` makes an event
// whose detail is null where page script's carries 5. The same drops `body`
// from `fetch(url, { method: "POST", body: text })`: a POST with no body.
//
// Today the call is emitted, with the struct of `bubbles` alone -- this
// expectation. Fixed, a literal with a member its struct cannot carry is
// refused (or, where the binding spells the dictionary as parameters, takes
// the overload that has one), this stops holding, and it becomes a guard.
// Found by the Chromium lane (2026-10-14) binding dictionaries whose members'
// presence matters: a struct overload offered beside spread ones would be
// taken for a literal writing a member only the spread ones have, being the
// shorter, and the member lost.
//
// Control, one difference -- the literal without `detail` -- emits the same
// call and drops nothing:
//
//     new CustomEvent("ready", { bubbles: true })

export function go(): number {
  const event = new CustomEvent("ready", { bubbles: true, detail: 5 });
  return event.bubbles ? 1 : 0;
}
