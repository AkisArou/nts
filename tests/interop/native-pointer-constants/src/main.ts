// The same integer annotation has a number control beside its native handle.
// Clean f03 refuses every native constant read with NTS1001, while numberControl
// compiles. The C consumer checks bits and ABI, rather than dereferencing them.
import {
  ALL_BITS, BROADCAST, FAILED, HIGH_BIT, NEGATIVE_THREE, NEGATIVE_TWO,
  NUMBER_CONTROL, READONLY, RESOURCE, VOID_POINTER, WIDE, ZERO,
  sentinel_from, sentinel_is_broadcast,
} from "c:pointer-constants";
import type { Sentinel, Window } from "c:pointer-constants";
import type { ConstPtr, Ptr } from "c:types";
import type { c_int, Uint16 } from "@nts/scalars";

export function broadcast(): Window { return BROADCAST; }
export function numberControl(): number { return NUMBER_CONTROL; }
export function resource(): Ptr<Uint16> { return RESOURCE; }
export function readonlyPointer(): ConstPtr<c_int> { return READONLY; }
export function voidPointer(): Ptr<unknown> { return VOID_POINTER; }
export function zero(): Sentinel { return ZERO; }
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
export function shorthand(): Sentinel { return ({ WIDE }).WIDE; }
