// `trim` and `split`, which are exact and which the profile asks for 13 times.
//
// Both have answers that are the specification's rather than the obvious ones,
// and node was asked for each rather than reasoned about:
//
//   "".split(",")  is [""]  — one empty piece
//   "".split("")   is []    — no pieces, the one special case
//   "a😀".split("") is three, not two: an empty separator cuts between code
//                            *units*, so a surrogate pair comes apart — where
//                            `for...of` over the same string yields two.
//
// And `trim` removes more than an ASCII test would: NBSP and the byte order
// mark are whitespace here.

export function trimming(n: number): number {
  const padded = "   \t\n x \t\n  ";
  return padded.trim().length * 10000 +
    padded.trimStart().length * 100 +
    padded.trimEnd().length +
    n * 0;
}

export function nothingToTrim(n: number): number {
  const tight = "abc";
  return tight.trim().length * 100 + tight.trimStart().length * 10 + tight.trimEnd().length + n * 0;
}

export function allWhitespace(n: number): number {
  const blank = "  \t \n ";
  return blank.trim().length * 10 + (blank.trim() === "" ? 1 : 0) + n * 0;
}

// The byte order mark and a non-breaking space are whitespace to `trim`.
export function unicodeWhitespace(n: number): number {
  const odd = "\u{feff}\u{00a0} x \u{2003}";
  return odd.trim().length * 10 + (odd.trim() === "x" ? 1 : 0) + n * 0;
}

export function splitting(n: number): number {
  return "a,,b".split(",").length * 10000 +
    ",a,".split(",").length * 1000 +
    "".split(",").length * 100 +
    "".split("").length * 10 +
    "abc".split("x").length +
    n * 0;
}

export function pieces(n: number): number {
  const parts = ",a,".split(",");
  return parts.length * 1000 + parts[0].length * 100 + parts[1].length * 10 + parts[2].length + n * 0;
}

// A separator longer than one unit, and one that is not there at all.
export function multiUnitSeparator(n: number): number {
  const cut = "aXXbXXc".split("XX");
  const whole = "aXXb".split("YY");
  return cut.length * 1000 + cut[2].length * 100 + whole.length * 10 + whole[0].length + n * 0;
}

// An empty separator cuts between code units, which is why an astral character
// comes apart into two pieces where `for...of` gives one.
export function byCodeUnit(n: number): number {
  const units = "a\u{1F600}b".split("");
  let points = 0;
  for (const c of "a\u{1F600}b") {
    points++;
  }
  return units.length * 100 + points * 10 + units[0].length + n * 0;
}

// The pieces are real strings the array owns, readable after the split.
export function piecesAreStrings(n: number): number {
  const parts = "alpha,be,c".split(",");
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
  return total * 10 + parts.length + n * 0;
}

// `replace` and `replaceAll`, whose replacement string is not copied
// literally: `$$`, `$&`, `` $` `` and `$'` each stand for something, and
// anything else after a `$` stays as it is. node settled every one of these,
// including the two the empty pattern produces --
//
//     "abc".replace("", "+")     is "+abc"
//     "abc".replaceAll("", "-")  is "-a-b-c-"
//
// -- the second of which puts a separator on both ends, because an empty
// pattern matches at the end position as well as before every character.
export function replacingFirst(n: number): string {
  const subjects = ["a-b-c", "abc", "", "--", "a"];
  const patterns = ["-", "", "x", "--"];
  const replacements = ["+", "", "$$", "[$&]", "[$`]", "[$']", "$x", "<$>"];
  let out = "";
  for (const s of subjects) {
    for (const p of patterns) {
      for (const r of replacements) {
        out = out + s.replace(p, r) + "|";
      }
    }
  }
  return out + n;
}

export function replacingEvery(n: number): string {
  const subjects = ["a-b-c", "abc", "", "--", "aaa"];
  const patterns = ["-", "", "a", "aa"];
  const replacements = ["+", "", "$$", "[$&]", "[$`]", "[$']", "$"];
  let out = "";
  for (const s of subjects) {
    for (const p of patterns) {
      for (const r of replacements) {
        out = out + s.replaceAll(p, r) + "|";
      }
    }
  }
  return out + n;
}

// A two-byte subject and a narrow replacement, and the reverse, because the
// result's width is decided from both. The surrogate pair is there because
// `$&` copies a slice of the subject by code *unit* and a pair must survive it.
export function replacingWideText(n: number): string {
  const s = "héllo wörld";
  return (
    s.replace("ö", "o") +
    s.replaceAll("l", "L") +
    "\u{1F600}x".replace("x", "$&$&") +
    "plain".replace("a", "ä") +
    n
  );
}
