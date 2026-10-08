// expect: emit-c --rc -> NTS1001 a `StringView` written into a struct the program holds; it is lent only for a call
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
// Control (emit-c --rc), one difference -- the member written is a boolean,
// `{ repeat: true }`: nothing refused.
export function keyDown(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "a" });
}
