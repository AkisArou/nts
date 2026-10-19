// `pointerBits` is a pointer's bits as C's `(uintptr_t)p` has them, with no
// load: the consumer passes addresses nothing may read through -- resource
// atoms 0, 1 and 65535, the 65536 boundary, the high bit, every bit -- and real
// stack, heap and static storage, and checks each answer against its own
// `(uintptr_t)p`. The one-difference control is
// tests/refusals/pointer-bits-by-assertion.ts: `bits` with
// `p as unknown as c_uintptr_t`, which stays refused.
// expect-ir: c llvm: count native.bits in bits == 1
// expect-ir: c llvm: no native.load in bits
// expect-ir: c llvm: no retain in bits
// expect-ir: c llvm: no release in bits
// expect-ir: c llvm: no retain in windowBits
// expect-ir: c llvm: no release in windowBits
// expect-ir: c llvm: no native.load in isIntResource
// expect-ir: c llvm: no native.load in atom
// expect-ir: c llvm: count native.bits in stride == 2
import type { ConstPtr, Ptr } from "c:types";
import type { c_uintptr_t, Uint16, Uint32 } from "@nts/scalars";
import { addrOf, local, pointerBits } from "c:memory";
import { free, malloc } from "c:stdlib";
import { bits_text } from "c:pointer-bits";
import type { Item, Window } from "c:pointer-bits";

export function bits(p: ConstPtr<Uint16> | null): c_uintptr_t { return pointerBits(p); }
export function mutableBits(p: Ptr<Uint16>): c_uintptr_t { return pointerBits(p); }
export function itemBits(item: Item): c_uintptr_t { return pointerBits(item); }
export function windowBits(window: Window | null): c_uintptr_t { return pointerBits(window); }
export function nullBits(): c_uintptr_t { return pointerBits(null); }
// A pointer that arrived from C inside the program, not through a parameter.
export function textBits(): c_uintptr_t { return pointerBits(bits_text()); }
// winuser.h: #define IS_INTRESOURCE(r) ((((ULONG_PTR)(r)) >> 16) == 0)
export function isIntResource(p: ConstPtr<Uint16> | null): boolean {
  return (pointerBits(p) >> 16n) === 0n;
}
// MAKEINTRESOURCE's inverse: the low sixteen bits, and 0 for NULL.
export function atom(p: ConstPtr<Uint16> | null): number { return Number(pointerBits(p) & 0xffffn); }
// Two real addresses one element apart: the bits agree with C's arithmetic.
export function stride(): number {
  const q = local<Uint32>(2);
  return Number(pointerBits(addrOf(q[1])) - pointerBits(q));
}
export function heapStride(): number {
  const block = malloc<Uint16>(4);
  if (block === null) return -1;
  const step = Number(pointerBits(addrOf(block[1])) - pointerBits(block));
  free(block);
  return step;
}
