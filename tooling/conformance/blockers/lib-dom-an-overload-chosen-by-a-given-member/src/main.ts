// expect: emit-c --rc -> emits-c keep_text(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// lib.dom member a binding spells as several C functions is the one whose
// parameters fit the call, and a dictionary literal fits a record only where
// each member it writes names a field (`record_holds`). A `Given<T>` field
// (c:types) is written from the member's value -- its `T`, or `undefined`,
// decided at run time -- so a literal's `keepalive: true` fits it.
//
// It did not: the field's pair struct was asked to hold the literal's value as
// though the value were a nested record literal, a boolean is not, and no
// overload fitted; the fallback took the first, whose `Request` input `"u"`
// cannot be (src/keep.d.ts: two overloads differing only in their input).
// Found by the Chromium lane (2026-10-14) binding RequestInit's `keepalive` as
// a Given field.
//
// Control, one difference -- a plain member -- emits `keep_text(`:
//
//     return new Request("u", { method: "POST" }).keepalive;

export function go(): boolean {
  return new Request("u", { keepalive: true }).keepalive;
}
