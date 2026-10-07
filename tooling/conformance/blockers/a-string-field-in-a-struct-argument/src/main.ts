// expect: emit-c --rc -> emits-c nts_string_unlend(
//
// A C struct written as an object literal (`Fields<T>`) cannot have a string
// field: `StringView`, or a string-literal union, refuses the whole
// argument. Every option dictionary with a string member hits it:
// IntersectionObserver's rootMargin, ShadowRootInit's mode (an enum),
// AddEventListenerOptions beside `passive`. The Chromium lane binds only the
// boolean and numeric members of a dictionary, and drops a dictionary whose
// required member is a string (runtime/chromium/contracts/workarounds.md,
// 18). Found 2026-10-07. A string field would be borrowed for the call, as a
// `StringView` parameter is.
//
// **FIXED 2026-10-07 for `StringView`, and kept as a guard**: the field is the
// string itself, lent for the call the literal is written for; the string's
// last use is `nts_string_unlend` after the call, so reference counting does
// not release a temporary (`margin + "px"`) before C reads it -- which the
// first version of the fix did. A string-literal union is still refused: as a
// field it would be a `const char *`, which a raw `Ptr<c_char>` field also is,
// so a binding types an enum member `StringView` to have it lent.
//
// Control, one difference -- the boolean alone:
//
//     export type Init = Struct<{ trackVisibility: CBool<c_uint8> }, "ObserverInit">;
//     observe({ trackVisibility: true });
//
// compiles.

import { observe } from "nts:observer";
export function go(margin: string): number {
  observe({ rootMargin: margin + "px", trackVisibility: true });
  return 0;
}
