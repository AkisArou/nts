// expect: NTS1001 an assertion to unknown from a value with no erased representation
//
// A pointer's bits by assertion: `p as unknown as c_uintptr_t` checks in
// TypeScript and converts nothing -- a C pointer has no erased form to widen
// to, and an assertion makes no number of one. The bits are `pointerBits(p)`
// (`c:memory`), the one operation that makes a number of a pointer.
//
// **A guard from the day it was written (2026-10-19)**, beside that
// operation: it refused before `pointerBits` existed and refuses after, so it
// does not test the operation; it shows the operation opened no other door.
//
// Control, one difference -- `pointerBits(p)` in place of the assertion:
// `bits` in tests/interop/native-pointer-bits, which lowers to one
// `native.bits` and agrees with C's `(uintptr_t)p`.
import type { ConstPtr } from "c:types";
import type { c_uintptr_t, Uint16 } from "@nts/scalars";

export function bits(p: ConstPtr<Uint16> | null): c_uintptr_t {
  return p as unknown as c_uintptr_t;
}
