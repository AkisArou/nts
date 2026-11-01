// Uppercase Greek passed to toUpperCase: unchanged non-ASCII input must keep
// its string without allocation. Inputs vary per round, with fixed work.
export function convert(seed: number): number {
  const inputs: string[] = [];
  for (let i = 0; i < 16; i++) {
    inputs.push("ΑΒΓΔ ΕΖΗΘ ΙΚΛΜ ΝΞΟΠ ΡΣΤΥ ΦΧΨΩ " + String(seed | 0) + String(i));
  }
  let total = 0;
  for (let round = 0; round < 64; round++) {
    const s = inputs[round % 16]!.toUpperCase();
    total = (total + s.length + s.charCodeAt(0)) | 0;
  }
  return total;
}

/** The source-declared input, shared by every benchmark driver. */
export const seed = 3;
