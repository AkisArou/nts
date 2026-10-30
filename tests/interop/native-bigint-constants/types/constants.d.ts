/** @ntsHeader "constants.h" */
declare module "c:bigint-constants" {
  import type { BigInt64, BigUint64 } from "@nts/scalars";
  /** @ntsConstant 9007199254740993 */
  export const POSITIVE: BigInt64;
  /** @ntsConstant -9007199254740993 */
  export const NEGATIVE: BigInt64;
  /** @ntsConstant -9223372036854775808 */
  export const SIGNED_MIN: BigInt64;
  /** @ntsConstant 9223372036854775807 */
  export const SIGNED_MAX: BigInt64;
  /** @ntsConstant 18446744073709551615 */
  export const UNSIGNED_MAX: BigUint64;
  export function accept_signed(value: BigInt64): BigInt64;
  export function accept_unsigned(value: BigUint64): BigUint64;
}
