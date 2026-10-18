// Void pointers carry addresses, never an element that TypeScript can read.
// The one-alias control changes Input from Ptr<void> to Ptr<Uint8>.
// Both arms return the same static C storage; the consumer checks identity.
// Landed b5f5915b03c5 rejects only the subject's typed-to-void call (TS2345).
// Changing that alias alone compiles and runs every export on C and LLVM.
// expect-ir: c llvm: count call.native in typedToVoid == 1
// expect-ir: c llvm: no erase in typedToVoid
// expect-ir: c llvm: no unerase in typedToVoid
// expect-ir: c llvm: no retain in typedToVoid
// expect-ir: c llvm: no release in typedToVoid
// expect-ir: c llvm: count native.load in output == 1
// expect-ir: c llvm: count native.load in constOutput == 1
// expect-ir: c llvm: no retain in output
// expect-ir: c llvm: no release in output
// expect-ir: c llvm: no retain in constOutput
// expect-ir: c llvm: no release in constOutput
import type { ConstPtr, Ptr } from "c:types";
import type { c_int, Uint8 } from "@nts/scalars";
import { local } from "c:memory";
import { vp_address, vp_bytes, vp_const_address, vp_const_fill, vp_fill } from "c:void-pointer";

type Input = Ptr<void>;
function identity(p: Input): Input { return p; }
export function typedToVoid(): Input { return identity(vp_bytes()); }
export function typedControl(): Ptr<Uint8> { return vp_bytes(); }
export function returned(present: c_int): Ptr<void> | null { return vp_address(present); }
export function constReturned(present: c_int): ConstPtr<void> | null { return vp_const_address(present); }
export function output(present: c_int): Ptr<void> | null {
  const slot = local<Ptr<void> | null>();
  vp_fill(slot, present);
  return slot[0];
}
export function constOutput(present: c_int): ConstPtr<void> | null {
  const slot = local<ConstPtr<void> | null>();
  vp_const_fill(slot, present);
  return slot[0];
}
export function isNull(present: c_int): boolean { return vp_address(present) === null; }
