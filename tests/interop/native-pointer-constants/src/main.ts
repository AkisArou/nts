// The same integer annotation has a number control beside its native handle.
// Clean f03 compiles numberControl, but loses the native constant's pointer type:
// returns/arguments refuse with NTS1001, and equality emits invalid C. The C
// consumer checks bits and ABI, rather than dereferencing these sentinels.
// expect-ir: c llvm: count const.handle in broadcast == 1
// expect-ir: c llvm: no convert in broadcast
// expect-ir: c llvm: no retain in broadcast
// expect-ir: c llvm: no release in broadcast
// expect-ir: c llvm: count const.handle in resource == 1
// expect-ir: c llvm: count const.handle in wide == 1
// expect-ir: c llvm: count const.handle in returnedEquals == 1
// expect-ir: c llvm: no const.handle in zero
// expect-ir: c llvm: count const in zero == 1
import {
  ALL_BITS, BROADCAST, FAILED, HIGH_BIT, NEGATIVE_THREE, NEGATIVE_TWO,
  NUMBER_CONTROL, READONLY, RESOURCE, VOID_POINTER, WIDE, ZERO,
  sentinel_from, sentinel_is_broadcast,
} from "c:pointer-constants";
import type { Sentinel, Window } from "c:pointer-constants";
import type { ConstPtr, Ptr } from "c:types";
import type { c_int, Uint16 } from "@nts/scalars";
import * as Constants from "c:pointer-constants";

export function broadcast(): Window { return BROADCAST; }
export function numberControl(): number { return NUMBER_CONTROL; }
export function resource(): Ptr<Uint16> { return RESOURCE; }
export function readonlyPointer(): ConstPtr<c_int> { return READONLY; }
export function voidPointer(): Ptr<void> { return VOID_POINTER; }
export function zero(): Sentinel | null { return ZERO; }
export function failed(): Sentinel { return FAILED; }
export function negativeTwo(): Sentinel { return NEGATIVE_TWO; }
export function negativeThree(): Sentinel { return NEGATIVE_THREE; }
export function wide(): Sentinel { return WIDE; }
export function highBit(): Sentinel { return HIGH_BIT; }
export function allBits(): Sentinel { return ALL_BITS; }
export function nativeArgument(): boolean { return sentinel_is_broadcast(BROADCAST); }
// MAP_FAILED's shape: the returned pointer can match or differ from the sentinel.
export function returnedEquals(fail: c_int): boolean { return sentinel_from(fail) === FAILED; }
export function localAlias(): Sentinel { const value = WIDE; return value; }
export function namespaceAlias(): Window { return Constants.BROADCAST; }
export function zeroIsNull(): boolean { return ZERO === null; }
export function broadcastIsNull(): boolean { return BROADCAST === null; }
export function zeroIsTruthy(): boolean { return !!ZERO; }
export function broadcastIsTruthy(): boolean { return !!BROADCAST; }
export function shorthand(): Sentinel {
  const box: { WIDE: Sentinel } = { WIDE };
  return box.WIDE;
}
