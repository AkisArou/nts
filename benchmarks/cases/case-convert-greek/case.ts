// `toLowerCase` and `toUpperCase` over Greek text: the two-byte
// (UTF-16) table path, with tonos accents.
//
// No word here ends in sigma, in either case, on either conversion.
// Final_Sigma -- "ΑΣ" lowercasing its last letter to ς -- is a context
// rule, guarded in `tests/programs/a-final-sigma-lowercased`; keeping it
// out of the text is what lets this row isolate the unconditional Greek
// mapping's cost.
//
// No C++ column: as `case-convert` says, the honest C++ program here is
// ICU, not a reference. Java's case conversion agrees with
// JavaScript's over this text, tonos included.
//
// The inputs vary per round, as in `case-convert`, for its reason.

const BASE = "Σοφία Σχολείο αστερι μέση Θάλασσα κήπος φωτιά ";

export function convert(seed: number): number {
  const base = BASE + String(seed | 0);
  const inputs: string[] = [];
  for (let i = 0; i < 16; i++) {
    inputs.push(base + String(i));
  }

  let total = 0;
  for (let round = 0; round < 64; round++) {
    const s = inputs[round % 16]!;
    const lower = s.toLowerCase();
    const upper = s.toUpperCase();
    total = (total + lower.length + upper.length) | 0;
    total = (total + lower.charCodeAt(0) + upper.charCodeAt(0)) | 0;
  }
  return total;
}

/** The input the harness calls `convert` with (see `case-convert`). */
export const seed = 3;
