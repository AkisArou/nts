// `toLowerCase` and `toUpperCase` over Latin-1 text: the first row that
// reaches the case tables (`case-convert` is ASCII and never does).
//
// Every accented letter here is in U+00C0..U+00FF, so conversion is a
// 256-entry table's work once the fast path gives up on ASCII: `ß` grows
// to `SS`, `ÿ` and `Ÿ` swap widths in UTF-8 but not in UTF-16, `µ`
// uppercases out of Latin-1 entirely (to Greek Μ). Node and Bun answer
// from ICU; nts from the same tables the compiler will own at stage 1
// ([unicode](../../docs/foundations/unicode.md)).
//
// There is no C++ column, for the reason `case-convert` gives: in the C
// locale `std::tolower` is a byte at a time, this text is multibyte, and
// honestly converting it in C++ means ICU, which is a different program
// rather than a reference for this one. Java's
// `toLowerCase(Locale.ROOT)` does mean the same function here, so there
// is a Java column.
//
// The inputs vary per round, as in `case-convert`, for its reason.

const BASE = "Café Ünïcödé naïve façade œuvre Straße ÿ µ ÀÉÎÕÜ ß ";

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
