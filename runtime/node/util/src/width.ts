// How many terminal columns a string occupies, from node v24.20.0
// `lib/internal/util/inspect.js`.
//
// Not the same as `String.length`: a CJK ideograph is one code unit wide in
// memory and two columns wide on screen, a combining accent is zero, and an
// ANSI colour sequence is several code units and no columns at all. Anything
// that draws a box around text -- `console.table`, `util.inspect`'s line
// breaking -- gets the box wrong if it counts code units.
//
// Node delegates to ICU when it has it and falls back to the ranges below when
// it does not. We have no ICU, so the fallback is the implementation; it is
// node's own code and node ships it to every no-intl build.

import { stripVTControlCharacters } from "./main.ts";

/**
 * True for a code point drawn two columns wide.
 *
 * The ranges are node's, partially derived from
 * https://www.unicode.org/Public/UNIDATA/EastAsianWidth.txt.
 */
export function isFullWidthCodePoint(code: number): boolean {
  return code >= 0x1100 && (
    code <= 0x115f || // Hangul Jamo
    code === 0x2329 || // LEFT-POINTING ANGLE BRACKET
    code === 0x232a || // RIGHT-POINTING ANGLE BRACKET
    // CJK Radicals Supplement .. Enclosed CJK Letters and Months
    (code >= 0x2e80 && code <= 0x3247 && code !== 0x303f) ||
    // Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
    (code >= 0x3250 && code <= 0x4dbf) ||
    // CJK Unified Ideographs .. Yi Radicals
    (code >= 0x4e00 && code <= 0xa4c6) ||
    // Hangul Jamo Extended-A
    (code >= 0xa960 && code <= 0xa97c) ||
    // Hangul Syllables
    (code >= 0xac00 && code <= 0xd7a3) ||
    // CJK Compatibility Ideographs
    (code >= 0xf900 && code <= 0xfaff) ||
    // Vertical Forms
    (code >= 0xfe10 && code <= 0xfe19) ||
    // CJK Compatibility Forms .. Small Form Variants
    (code >= 0xfe30 && code <= 0xfe6b) ||
    // Halfwidth and Fullwidth Forms
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    // Kana Supplement
    (code >= 0x1b000 && code <= 0x1b001) ||
    // Enclosed Ideographic Supplement
    (code >= 0x1f200 && code <= 0x1f251) ||
    // Miscellaneous Symbols and Pictographs .. Emoticons
    (code >= 0x1f300 && code <= 0x1f64f) ||
    // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** True for a code point that occupies no column: controls and combining marks. */
export function isZeroWidthCodePoint(code: number): boolean {
  return code <= 0x1f || // C0 control codes
    (code >= 0x7f && code <= 0x9f) || // C1 control codes
    (code >= 0x300 && code <= 0x36f) || // Combining Diacritical Marks
    (code >= 0x200b && code <= 0x200f) || // Modifying Invisible Characters
    (code >= 0x20d0 && code <= 0x20ff) || // Combining marks for symbols
    (code >= 0xfe00 && code <= 0xfe0f) || // Variation Selectors
    (code >= 0xfe20 && code <= 0xfe2f) || // Combining Half Marks
    (code >= 0xe0100 && code <= 0xe01ef); // Variation Selectors Supplement
}

/**
 * Columns required to display `str`.
 *
 * NFC first, so that `e` followed by a combining acute counts as the one
 * column the composed `é` occupies rather than the one-plus-zero it would
 * decomposed -- the same answer, but only because the zero-width table is
 * right; normalising makes it right for the marks the table omits too.
 */
export function getStringWidth(str: string, removeControlChars = true): number {
  let width = 0;

  if (removeControlChars) {
    str = stripVTControlCharacters(str);
  }
  str = str.normalize("NFC");
  for (const char of str) {
    const code = char.codePointAt(0)!;
    if (isFullWidthCodePoint(code)) {
      width += 2;
    } else if (!isZeroWidthCodePoint(code)) {
      width++;
    }
  }

  return width;
}
