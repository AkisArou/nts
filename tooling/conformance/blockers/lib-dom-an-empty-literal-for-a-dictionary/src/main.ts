// expect: a managed value where C takes a pointer: pass a handle, a `Ptr`,
//         or `null` is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): an
// object literal lib.dom types as a dictionary is copied into the struct
// nts:dom binds the dictionary by. An empty one -- `new CustomEvent("x",
// {})`, `scrollTo({})`, `new Request(url, {})`, an options bag with nothing
// in it -- is refused. `{}` is built as an object and erased
// (blockers/an-empty-object-literal), and the erased value is not taken as
// the record to copy from. Page script makes an event that does not bubble.
//
// Found by the Chromium lane (2026-10-14) writing a control for a
// dictionary member's presence.
//
// Fixed, a guard: `emit-c --rc -> emits-c nts_dom_new_CustomEvent_2(`.
//
// Control, one difference -- a member given -- emits that call:
//
//     return new CustomEvent("x", { bubbles: false }).bubbles;

export function go(): boolean {
  return new CustomEvent("x", {}).bubbles;
}
