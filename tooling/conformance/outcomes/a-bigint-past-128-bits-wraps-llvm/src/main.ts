// backend: llvm
// run: check
//
// A bigint past 128 bits wraps where node grows the number. C keeps a bigint
// in `__int128` and documents the shift (`1n << 200n` is 0 here); an add and a
// multiply that pass 2^127 wrap the same way, silently. shiftedPast(0) is "0"
// on C where node says 2^150's digits.
//
// Each case has a control that differs in one thing: the same operation on
// values that stay inside 128 bits, which agrees.
//
// The fix is to refuse by name past the width rather than wrap, on every
// backend: Wasm stores a bigint as one v128 and refuses there.
//
// Found planning the Wasm lane's bigint slice.

export function shiftedPast(v: number): string {
  return (1n << BigInt(((v | 0) & 63) + 150)).toString();
}

export function shiftedWithin(v: number): string {
  return (1n << BigInt(((v | 0) & 63) + 30)).toString();
}

export function addedPast(v: number): string {
  const half = 1n << 126n;
  return (half + half + BigInt((v | 0) & 7)).toString();
}

export function addedWithin(v: number): string {
  const half = 1n << 120n;
  return (half + half + BigInt((v | 0) & 7)).toString();
}

export function multipliedPast(v: number): string {
  return ((1n << 100n) * BigInt(((v | 0) & 1023) + 1073741824)).toString();
}

export function multipliedWithin(v: number): string {
  return ((1n << 60n) * BigInt(((v | 0) & 1023) + 1073741824)).toString();
}
