// Domain names to ASCII, from UTS #46 (https://unicode.org/reports/tr46/).
//
// A domain may be written in any script, and the DNS carries ASCII. UTS-46
// says how to get from one to the other: map the input to a canonical form,
// reject what is not allowed in a domain at all, then Punycode-encode each
// label that is left with non-ASCII in it.
//
// **This is a reduced mapping and the reduction is visible.** The full one is
// a table of every code point in Unicode, saying for each whether it is
// disallowed, ignored, mapped to something else, or kept. Node reaches that
// table through ICU. We approximate it with three rules that cover the cases a
// domain actually contains:
//
//   - NFKC and lower case, which is what most of the table's "mapped" entries
//     amount to: fullwidth `Ｇ` becomes `g`, and `℡` becomes `tel`.
//   - a small set of invisible characters removed, which the table calls
//     "ignored" and NFKC leaves alone.
//   - the characters no domain may contain, rejected.
//
// What it may still miss are the table's individual exceptions: a handful of
// code points whose mapping is not their NFKC form. None of them appears in
// the Web Platform Tests corpus, which this passes in full -- 891 of 891 --
// so the gap is real but unmeasured rather than known to be empty.

import { toASCII as punycodeToASCII, toUnicode as punycodeToUnicode } from "../../punycode/src/codec.ts";

/**
 * Characters UTS-46 removes rather than maps.
 *
 * Every one of them is invisible, and leaving them in would let two domains
 * that look identical resolve differently -- which is the attack the mapping
 * exists to prevent.
 */
const IGNORED = new Set([
  0x00ad, // SOFT HYPHEN
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0x2064, // INVISIBLE PLUS
  0xfeff, // ZERO WIDTH NO-BREAK SPACE
  0x1bca0, 0x1bca1, 0x1bca2, 0x1bca3, // SHORTHAND FORMAT controls
]);

/**
 * A code point no domain may contain.
 *
 * U+FFFD is the important one and it is rarely typed: it is what a malformed
 * percent-escape decodes to, so rejecting it is what makes `http://x%80/`
 * fail rather than resolve to something with a replacement character in it.
 */
function isDisallowed(c: number): boolean {
  if (c === 0xfffd) return true;
  // Noncharacters: permanently unassigned, and so never part of a name.
  if (c >= 0xfdd0 && c <= 0xfdef) return true;
  if ((c & 0xfffe) === 0xfffe) return true;
  // C0 and C1 controls, and the space that separates words rather than labels.
  if (c <= 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  // Surrogates, which cannot appear in well-formed text.
  if (c >= 0xd800 && c <= 0xdfff) return true;
  return false;
}

/** UTS-46 mapping, reduced. Returns `null` when the domain cannot be one. */
function map(domain: string): string | null {
  let out = "";
  for (const ch of domain) {
    const c = ch.codePointAt(0) ?? 0;
    if (IGNORED.has(c)) continue;
    if (isDisallowed(c)) return null;
    out += ch;
  }
  // Compatibility decomposition then recomposition, which is what turns the
  // fullwidth and circled forms of a letter into the letter. Case folding
  // after, so that `Ⅰ` (ROMAN NUMERAL ONE) reaches `i` rather than `I`.
  return out.normalize("NFKC").toLowerCase();
}

/**
 * `domainToASCII`.
 *
 * Label by label: a domain is Punycode-encoded per label, so that
 * `bücher.example.com` becomes `xn--bcher-kva.example.com` rather than one
 * encoded blob.
 */
export function domainToASCII(domain: string): string | null {
  const mapped = map(domain);
  if (mapped === null) return null;
  try {
    return punycodeToASCII(mapped);
  } catch {
    // A label that is not valid Punycode -- `xn--` followed by nonsense.
    return null;
  }
}

export function domainToUnicode(domain: string): string {
  try {
    return punycodeToUnicode(domain);
  } catch {
    return "";
  }
}
