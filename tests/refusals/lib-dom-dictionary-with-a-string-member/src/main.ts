// expect: emit-c --rc -> emits-c nts_string_unlend(
//
// A dictionary argument written under lib.dom's types, with a string
// member, is refused, though the object literal is the call's own argument:
// `new KeyboardEvent("keydown", { key: "a" })`, `el.attachShadow({ mode:
// "open" })`, `new Request(url, { method: "POST" })`. Bound directly
// (nts:dom's `newKeyboardEvent(type, { key })`) the same struct lends its
// StringView for the call and compiles; through lib.dom's delegation the
// literal is first a struct the program holds. Found 2026-10-08 by the
// Chromium lane, binding fetch.
//
// **A guard since 2026-10-08** (MainClaude): an object the program holds,
// copied into a record C takes by value, lends its `StringView` members for
// the call as a literal does (`native_record_from_object`). Run under
// AddressSanitizer by compiler/codegen/c/tests/native.rs
// `a_held_record_lends_its_string_member_for_the_call`.
//
// Control (emit-c --rc), one difference -- the member written is a boolean,
// `{ repeat: true }`: nothing refused.
export function keyDown(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "a" });
}
