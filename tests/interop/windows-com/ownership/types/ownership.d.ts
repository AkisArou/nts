/** @ntsHeader "ownership.h" */
declare module "c:ownership" {
  import type { c_int, c_uint } from "@nts/scalars";
  import type { ScopedClosure } from "c:types";
  import type { IEnumFixture } from "c:Windows.Win32.OwnershipProbe";
  export function ownership_start(mode: c_int, callback: ScopedClosure<(source: IEnumFixture) => void>): void;
  export function ownership_finish(): void;
  export function ownership_counter(index: c_uint): c_uint;
}
