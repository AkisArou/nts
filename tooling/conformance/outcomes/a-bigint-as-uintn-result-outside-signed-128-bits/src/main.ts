// run: check
//
// Changing only the mask width from 127 to 128 makes the unsigned result of
// a negative input exceed this runtime's signed 128-bit representation.
// The 127-bit control agrees with node. The 128-bit subject returns the
// original negative input instead of node's positive result.
// This is a pre-existing masking boundary: both the compiler before checked
// arithmetic and the checked-arithmetic candidate disagree on 29 of 58 cases.
// Independent probes reproduce it on C, LLVM and the JVM.

function negativeValue(v: number): bigint {
  return -BigInt((v | 0) & 255) - 1n;
}

export function signedWidthControl(v: number): string {
  return BigInt.asUintN(127, negativeValue(v)).toString();
}

export function unsignedWidthSubject(v: number): string {
  return BigInt.asUintN(128, negativeValue(v)).toString();
}
