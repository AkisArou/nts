// expect: `keepalive`, a member the binding's `NtsDomRequestInit` has no field
//         for, which would be dropped
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): an
// object literal lib.dom types as a dictionary is copied into the struct
// nts:dom binds the dictionary by, and a struct reads zero as "left out".
// Where Blink asks whether a member was given (`hasKeepalive()`), zero is not
// left out: `new Request(base, { keepalive: false })` makes a request that
// does not keep alive, whatever `base` did, where `new Request(base, {})` and
// `{ keepalive: undefined }` (WebIDL: absent) keep base's. The Chromium lane
// binds such members by spread overloads where there are at most four; RequestInit
// has eleven with its strings, so its struct leaves `keepalive` out and the
// copy refuses it by name.
//
// Wanted (the compiler lane, 2026-10-14): a c:types struct field that
// carries whether the member was given -- `Given<T>`, C `struct { bool
// given; T value; }`, given when the value is not undefined, computed at run
// time -- and RequestInit's `keepalive` bound as one. Page script, with
// `base` a request made with `{ keepalive: true }`: false, true, true for
// `{ keepalive: false }`, `{}` and `{ keepalive: undefined }`.
//
// Found by the Chromium lane (2026-10-14) binding dictionaries whose members'
// presence matters (chromium/dict-presence).
//
// Fixed, a guard: `emit-c --rc -> emits-c nts_dom_new_Request_2_Request(`.
//
// Control, one difference -- a string member, whose view says whether it was
// given -- emits that call:
//
//     return new Request(base, { method: "GET" }).keepalive;

export function go(base: Request): boolean {
  return new Request(base, { keepalive: false }).keepalive;
}
