// expect: NTS1001 foreign function `observer_observe`'s parameter `init` (which wants a c_int or c_double brand, a boolean, or a string), a type with no native ABI is not supported by this lowering yet
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
