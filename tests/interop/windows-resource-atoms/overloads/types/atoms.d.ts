/** @ntsHeader "atoms.h" */
declare module "c:resource-overload-probe" {
  import type { Utf16String, ConstPtr } from "c:types";
  import type { BigInt64, Uint16, c_int } from "@nts/scalars";
  /** @ntsConstant 32512 */ export const ATOM: ConstPtr<Uint16>;
  export function accept_name(name: ConstPtr<Uint16>): c_int;
  export function accept_name(name: Utf16String): c_int;
  // As the Win32 binding spells ENUMRESLANGPROCW's `lpType` and `lpName`.
  export type name_proc = (type: ConstPtr<Uint16>, name: ConstPtr<Uint16>, language: Uint16, parameter: BigInt64) => c_int;
  export function enumerate_names(proc: name_proc, parameter: BigInt64): c_int;
}
