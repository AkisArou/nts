/** @ntsHeader "atoms.h" */
declare module "c:resource-overload-probe" {
  import type { Utf16String, ConstPtr } from "c:types";
  import type { Uint16, c_int } from "@nts/scalars";
  /** @ntsConstant 32512 */ export const ATOM: ConstPtr<Uint16>;
  export function accept_name(name: ConstPtr<Uint16>): c_int;
  export function accept_name(name: Utf16String): c_int;
}
