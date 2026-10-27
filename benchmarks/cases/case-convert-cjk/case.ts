// `toLowerCase` and `toUpperCase` over CJK text, which has no case:
// the row measures the scan that finds nothing to change in two-byte
// text -- the table lookups, the width handling and the allocation the
// unchanged result still costs today. Stage 1's "an unchanged string
// is returned as is" contract is what this row and
// `case-convert-unchanged` together price
// ([unicode](../../docs/foundations/unicode.md)).
//
// The leading "A" keeps the checksum's first character the same unit
// in every column. No C++ column: a `std::string` measures UTF-8
// bytes where JavaScript and Java measure UTF-16 units, so even the
// lengths would not be the same number.
//
// The inputs vary per round, as in `case-convert`, for its reason.

const BASE = "A中文字符 日本語 テスト 漢字 かな カナ 汉语 ";

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
