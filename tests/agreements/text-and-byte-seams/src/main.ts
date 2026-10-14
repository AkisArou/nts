// Text and bytes: the surface `buffer` and `string_decoder` sit on. Each
// answers a number.
//
// The null-character cases are written with `\u0000` escapes rather than raw
// bytes. A literal NUL in a source file is a control character that tooling
// between here and the compiler may refuse to carry -- it stopped two attempts
// to write this file -- and the question is about the string's contents either
// way.

// `loneSurrogateLength` lived here and now has its own case file,
// `a-lone-surrogate-in-a-string`, with the four controls that place it: ASCII,
// a two-byte character, a three-byte character and a surrogate *pair* all
// answer in code units correctly. Only an unpaired surrogate is counted in its
// encoding's bytes.

/** codePointAt reads the whole pair. */
export function codePointAtPair(): number {
  const cp = "\u{1F600}".codePointAt(0);
  return cp === undefined ? -1 : cp;
}

/** fromCharCode builds from code units. */
export function fromCharCodeUnits(): number {
  return String.fromCharCode(0xd83d, 0xde00).length;
}

/** A string with a null character keeps its length. */
export function nullCharacterLength(): number {
  return "a\u0000b".length;
}

/** Comparing strings that differ only past a null.
 *
 * Through `string`-typed bindings rather than two literals: TypeScript narrows
 * literal types and reports `"a\u0000b" === "a\u0000c"` as an unintentional
 * comparison (TS2367), so the file does not typecheck and `emit-c` writes
 * nothing. The question is whether the bytes after the null are compared, and
 * a binding asks it without the checker answering first. */
export function comparePastNull(): number {
  const left: string = "a\u0000b";
  const right: string = "a\u0000c";
  return left === right ? 1 : 0;
}

/** A Uint8Array's length and element read. */
export function typedArrayBasics(): number {
  const u = new Uint8Array(3);
  u[1] = 200;
  return u.length * 1000 + (u[1] ?? -1);
}

/** Uint8Array elements wrap at 256. */
export function typedArrayWraps(): number {
  const u = new Uint8Array(1);
  u[0] = 300;
  return u[0] ?? -1;
}

/** A negative value written to a Uint8Array wraps too. */
export function typedArrayNegativeWraps(): number {
  const u = new Uint8Array(1);
  u[0] = -1;
  return u[0] ?? -1;
}

/** charCodeAt past the end is NaN, not an error. */
export function charCodeAtPastEnd(): number {
  const n = "abc".charCodeAt(9);
  return n === n ? 1 : 0;
}

/** normalize leaves an already-composed string alone. */
export function normalizeIdempotent(): number {
  return "abc".normalize().length;
}
