// expect: emit-c --rc -> emits-c nts_dom_new_CustomEvent_2(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): an
// object literal lib.dom types as a dictionary is copied into the struct
// nts:dom binds the dictionary by. An empty one -- `new CustomEvent("x",
// {})`, `scrollTo({})`, `new Request(url, {})`, an options bag with nothing
// in it -- was refused. `{}` is built as an object and erased
// (blockers/an-empty-object-literal), and the erased value was not taken as
// the record to copy from. Page script makes an event that does not bubble.
// A literal that writes no member is now the record's zeroed storage
// (lower.rs `coerce_to_native_pointer`).
//
// Found by the Chromium lane (2026-10-14) writing a control for a
// dictionary member's presence.
//
// Control, one difference -- a member given -- emits that call:
//
//     return new CustomEvent("x", { bubbles: false }).bubbles;

export function go(): boolean {
  return new CustomEvent("x", {}).bubbles;
}
