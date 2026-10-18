/** @ntsHeader "constants.h" */
declare module "c:pointer-constants" {
  import type { Class, ConstPtr, Opaque, Ptr } from "c:types";
  import type { c_int, Uint16 } from "@nts/scalars";

  export type Sentinel = Opaque<"Sentinel">;
  export type HandleBase = Class<"HandleBase">;
  export type Window = Class<"Window", HandleBase>;

  /** @ntsConstant 65535 */
  export const BROADCAST: Window;
  /** @ntsConstant 65535 */
  export const NUMBER_CONTROL: number;
  /** @ntsConstant 32512 */
  export const RESOURCE: Ptr<Uint16>;
  /** @ntsConstant 3 */
  export const READONLY: ConstPtr<c_int>;
  /** @ntsConstant 7 */
  export const VOID_POINTER: Ptr<unknown>;
  /** @ntsConstant 0 */
  export const ZERO: Sentinel | null;
  /** @ntsConstant -1 */
  export const FAILED: Sentinel;
  /** @ntsConstant -2 */
  export const NEGATIVE_TWO: Sentinel;
  /** @ntsConstant -3 */
  export const NEGATIVE_THREE: Sentinel;
  /** @ntsConstant 9007199254740993 */
  export const WIDE: Sentinel;
  /** @ntsConstant 0x8000000000000000 */
  export const HIGH_BIT: Sentinel;
  /** @ntsConstant 18446744073709551615 */
  export const ALL_BITS: Sentinel;

  export function sentinel_from(failed: c_int): Sentinel;
  export function sentinel_is_broadcast(value: Window): boolean;
}
