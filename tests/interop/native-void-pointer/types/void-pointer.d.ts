/** @ntsHeader "void-pointer.h" */
declare module "c:void-pointer" {
  import type { ConstPtr, Ptr } from "c:types";
  import type { c_int, Uint8 } from "@nts/scalars";
  export function vp_bytes(): Ptr<Uint8>;
  export function vp_address(present: c_int): Ptr<void> | null;
  export function vp_const_address(present: c_int): ConstPtr<void> | null;
  /** @ntsNoEscape out */
  export function vp_fill(out: Ptr<Ptr<void> | null>, present: c_int): void;
  /** @ntsNoEscape out */
  export function vp_const_fill(out: Ptr<ConstPtr<void> | null>, present: c_int): void;
}
