// Case conversion of text whose case is already right: lowercase in
// through `toLowerCase`, uppercase in through `toUpperCase`.
//
// This is most real calls (header names are already lowercase), and
// the row prices the contract stage 1 changes: today the result is
// always a fresh string; the design returns the input itself when
// nothing changed, with no allocation
// ([unicode](../../docs/foundations/unicode.md)). ASCII, so the C++
// column is honest here as it is for `case-convert`.
//
// The inputs vary per round, as in `case-convert`, for its reason.
export function convert(seed: number): number {
  const lowers: string[] = [];
  const uppers: string[] = [];
  for (let i = 0; i < 16; i++) {
    lowers.push("the quick brown fox jumps over the lazy dog " + String(seed | 0) + String(i));
    uppers.push("THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG " + String(seed | 0) + String(i));
  }

  let total = 0;
  for (let round = 0; round < 64; round++) {
    const lower = lowers[round % 16]!.toLowerCase();
    const upper = uppers[round % 16]!.toUpperCase();
    total = (total + lower.length + upper.length) | 0;
    total = (total + lower.charCodeAt(0) + upper.charCodeAt(0)) | 0;
  }
  return total;
}

/** The input the harness calls `convert` with (see `case-convert`). */
export const seed = 3;
