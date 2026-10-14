// run: check
//
// BigInt.asIntN/asUintN apply ToIndex to the width before masking. Invalid
// widths must throw a catchable RangeError, even when the result is unused.
// Each invalid-width arm has controls that change only the width; values are
// nonnegative and at most 260, so unsigned overflow cannot hide this defect.
// The raw masking calls are in helpers called inside the caller's try.
// Before the fix C and LLVM disagree with node on all 406 cases in the 14 invalid-
// width exports. The other 24 exports independently agree on 696 cases.
// Node v24.20.0/V8 currently says:
// "Invalid value: not (convertible to) a safe integer".
// This is current oracle text, not specification wording.
// Fractions truncate toward zero, NaN becomes zero, and the largest safe
// integer is a valid width. The runtime used to skip width validation.

function nonnegative(v: number): bigint {
  return BigInt((v | 0) & 255) + 5n;
}

function maskInt(width: number, value: bigint): bigint {
  return BigInt.asIntN(width, value);
}

function maskUint(width: number, value: bigint): bigint {
  return BigInt.asUintN(width, value);
}

function answer(width: number, v: number, signed: boolean): string {
  try {
    const value = nonnegative(v);
    return (signed ? maskInt(width, value) : maskUint(width, value)).toString();
  } catch (error) {
    if (error instanceof RangeError) return "RangeError: " + error.message;
    return "unexpected error";
  }
}

export function signedZero(v: number): string { return answer(0, v, true); }
export function signedOne(v: number): string { return answer(1, v, true); }
export function signedSixtyFour(v: number): string { return answer(64, v, true); }
export function signedOneTwentyEight(v: number): string { return answer(128, v, true); }
export function signedOneTwentyNine(v: number): string { return answer(129, v, true); }
export function signedNegativeOne(v: number): string { return answer(-1, v, true); }
export function signedTooLarge(v: number): string { return answer(2 ** 53, v, true); }
export function signedInfinity(v: number): string { return answer(Infinity, v, true); }
export function signedNaN(v: number): string { return answer(NaN, v, true); }
export function signedNegativeInfinity(v: number): string { return answer(-Infinity, v, true); }
export function signedNegativeFractionToZero(v: number): string { return answer(-0.9, v, true); }
export function signedNegativeFractionPastZero(v: number): string { return answer(-1.9, v, true); }
export function signedFractionBelow128(v: number): string { return answer(127.9, v, true); }
export function signedFractionAbove128(v: number): string { return answer(128.5, v, true); }
export function signedLargestSafeInteger(v: number): string { return answer(2 ** 53 - 1, v, true); }

export function unsignedZero(v: number): string { return answer(0, v, false); }
export function unsignedOne(v: number): string { return answer(1, v, false); }
export function unsignedSixtyFour(v: number): string { return answer(64, v, false); }
export function unsignedOneTwentyEight(v: number): string { return answer(128, v, false); }
export function unsignedOneTwentyNine(v: number): string { return answer(129, v, false); }
export function unsignedNegativeOne(v: number): string { return answer(-1, v, false); }
export function unsignedTooLarge(v: number): string { return answer(2 ** 53, v, false); }
export function unsignedInfinity(v: number): string { return answer(Infinity, v, false); }
export function unsignedNaN(v: number): string { return answer(NaN, v, false); }
export function unsignedNegativeInfinity(v: number): string { return answer(-Infinity, v, false); }
export function unsignedNegativeFractionToZero(v: number): string { return answer(-0.9, v, false); }
export function unsignedNegativeFractionPastZero(v: number): string { return answer(-1.9, v, false); }
export function unsignedFractionBelow128(v: number): string { return answer(127.9, v, false); }
export function unsignedFractionAbove128(v: number): string { return answer(128.5, v, false); }
export function unsignedLargestSafeInteger(v: number): string { return answer(2 ** 53 - 1, v, false); }

function discard(width: number, v: number, signed: boolean): void {
  if (signed) BigInt.asIntN(width, nonnegative(v));
  else BigInt.asUintN(width, nonnegative(v));
}

function discarded(width: number, v: number, signed: boolean): string {
  try {
    discard(width, v, signed);
    return "returned";
  } catch (error) {
    if (error instanceof RangeError) return "RangeError: " + error.message;
    return "unexpected error";
  }
}

export function discardedSignedInvalid(v: number): string { return discarded(-1, v, true); }
export function discardedSignedControl(v: number): string { return discarded(0, v, true); }
export function discardedUnsignedInvalid(v: number): string { return discarded(-1, v, false); }
export function discardedUnsignedControl(v: number): string { return discarded(0, v, false); }

function widthEffect(state: { count: number }, width: number): number {
  state.count = state.count * 10 + 1;
  return width;
}

function valueEffect(state: { count: number }, v: number): bigint {
  state.count = state.count * 10 + 2;
  return nonnegative(v);
}

function argumentOrder(width: number, v: number, signed: boolean): string {
  const state = { count: 0 };
  try {
    const result = signed
      ? BigInt.asIntN(widthEffect(state, width), valueEffect(state, v))
      : BigInt.asUintN(widthEffect(state, width), valueEffect(state, v));
    return "returned:" + state.count + ":" + result.toString();
  } catch (error) {
    if (error instanceof RangeError) return "caught:" + state.count + ":" + error.message;
    return "unexpected error";
  }
}

export function orderedSignedInvalid(v: number): string { return argumentOrder(-1, v, true); }
export function orderedSignedControl(v: number): string { return argumentOrder(0, v, true); }
export function orderedUnsignedInvalid(v: number): string { return argumentOrder(-1, v, false); }
export function orderedUnsignedControl(v: number): string { return argumentOrder(0, v, false); }
