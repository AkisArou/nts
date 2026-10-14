// A lone surrogate counts as three, where node counts one.
//
//     "abc"          compiled 3   node 3
//     "\u00e9"        compiled 1   node 1
//     "\u4e2d"        compiled 1   node 1
//     "\u{1F600}"     compiled 2   node 2     <- a surrogate *pair* is right
//     "\uD800"        compiled 3   node 1     <-
//     "\uDC00"        compiled 3   node 1     <-
//     "a\uD800b"      compiled 5   node 3     <-
//
// Every well-formed string agrees, including an astral character counted as
// the two code units it is. **An unpaired surrogate is stored in its
// three-byte encoding and counted as three**, and JavaScript strings are
// sequences of UTF-16 code units in which a lone surrogate is one unit and
// entirely legal.
//
// # Where it will be met
//
// `string_decoder` exists to hold partial UTF-8 sequences across chunk
// boundaries, and a partial sequence is exactly what produces a lone surrogate.
// Its `lastChar`, `lastNeed` and `lastTotal` are about nothing else. `buffer`\'s
// `toString("utf16le")` and every `latin1` round trip are the same surface.
//
// It is also the quiet kind: `"a\uD800b".length` answering 5 does not throw,
// and a test only fails if it compares a length or slices by index.
//
// # The mechanism, read from the emitted C
//
// The length is folded at compile time, and the fold is right for everything
// that can be encoded:
//
//     "\u4e2d".length      v1 = 1.0    one code unit, three UTF-8 bytes
//     "\u{1F600}".length   v1 = 2.0    two code units, four bytes
//     "\uD800".length      v1 = 3.0    <-
//
// Through a `const s: string` binding rather than a literal it is **still
// 3.0**, so this is not the constant folder disagreeing with the runtime -- the
// string is *stored* three units long.
//
// A lone surrogate has no UTF-8 encoding. Whatever form it is kept in --
// WTF-8's three bytes, or the replacement character's three bytes -- the length
// is that form's byte count rather than one code unit. Every encodable string
// gets a code-unit count, correctly; the unencodable one falls back to its
// storage.
//
// # The controls are the point
//
// Four of the seven agree, and they are the ones that would fail if this were
// "strings are measured in bytes". ASCII is 3 either way only because its bytes
// and units coincide, but `"\u00e9"` is one unit and two bytes and answers 1,
// and `"\u4e2d"` is one unit and three bytes and answers 1. So the length is in
// code units, correctly, until the string cannot be encoded -- and then it is
// the encoding\'s length.

export function ascii(): number {
  return "abc".length;
}

export function twoByteCharacter(): number {
  return "\u00e9".length;
}

export function threeByteCharacter(): number {
  return "\u4e2d".length;
}

export function surrogatePair(): number {
  return "\u{1F600}".length;
}

export function loneHighSurrogate(): number {
  return "\uD800".length;
}

export function loneLowSurrogate(): number {
  return "\uDC00".length;
}

export function loneSurrogateBetweenLetters(): number {
  return "a\uD800b".length;
}
