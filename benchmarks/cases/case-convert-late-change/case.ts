// A long unchanged Greek prefix followed by one changing unit, in both
// directions: scan once, then bulk-copy the prefix. Work is fixed; inputs vary.
export function convert(seed: number): number {
  const lowers: string[] = [];
  const uppers: string[] = [];
  for (let i = 0; i < 16; i++) {
    lowers.push("αβγδ εζηθ ικλμ νξοπ ρστυ φχψω αβγδ εζηθ ικλμ νξοπ ρστυ φχψω " + String(seed | 0) + String(i) + "Α");
    uppers.push("ΑΒΓΔ ΕΖΗΘ ΙΚΛΜ ΝΞΟΠ ΡΣΤΥ ΦΧΨΩ ΑΒΓΔ ΕΖΗΘ ΙΚΛΜ ΝΞΟΠ ΡΣΤΥ ΦΧΨΩ " + String(seed | 0) + String(i) + "α");
  }
  let total = 0;
  for (let round = 0; round < 64; round++) {
    const lower = lowers[round % 16]!.toLowerCase();
    const upper = uppers[round % 16]!.toUpperCase();
    total = (total + lower.length + upper.length +
      lower.charCodeAt(lower.length - 1) + upper.charCodeAt(upper.length - 1)) | 0;
  }
  return total;
}

/** The source-declared input, shared by every benchmark driver. */
export const seed = 3;
