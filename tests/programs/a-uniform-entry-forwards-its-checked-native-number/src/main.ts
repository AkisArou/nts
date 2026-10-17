// The native scalar body must receive the SSA value the entry checked.
// Each control computes the same answer without the function-value crossing.
// Main 547 refuses floatValue's uniform adapter (NTS5001, unproven float).
// Checkpoint 932 also refuses intValue and bigValue (unproven int/int64_t).
// The C native/ObjC and LLVM native suites independently pin the integer and
// bigint regressions on inputs whose typed callbacks main already compiles.
import type { c_int, Float32, BigInt64 } from "@nts/scalars";
export function invokeInt(f: (x: c_int) => number, x: c_int): number { return f(x); }
export function invokeFloat(f: (x: Float32) => number, x: Float32): number { return f(x); }
export function invokeBig(f: (x: BigInt64) => number, x: BigInt64): number { return f(x); }
function intValue(x: c_int): number { return x; }
function floatValue(x: Float32): number { return x; }
function bigValue(x: BigInt64): number { return Number(x); }
export function guardedInt(n: number): number { return invokeInt(intValue, n | 0); }
export function directInt(n: number): number { return n | 0; }
export function guardedFloat(n: number): number { return invokeFloat(floatValue, Math.fround(n)); }
export function directFloat(n: number): number { return Math.fround(n); }
export function guardedBig(n: number): number { return invokeBig(bigValue, BigInt.asIntN(64, BigInt(n | 0))); }
export function directBig(n: number): number { return Number(BigInt.asIntN(64, BigInt(n | 0))); }
