// expect: emits-c { 65533, 65533, 65533, 0 }
//
// The assertion is **the emitted literal's code units**, because that is the
// defect: `"\ud800"` is one code unit, 0xD800, and the program gets three
// U+FFFD. Pinned to the emission rather than to a refusal, since nothing
// refuses -- which is the whole point, and means this reads `reproduces` while
// the compiler is wrong and `CHANGED` on the day it is fixed.
//
// **A lone surrogate in a string literal is silently corrupted.** node answers
// `1` for its length and `55296` for its first code unit; this compiler answers
// `3` and `65533`. Found by the Windows lane while writing a UTF-16 boundary
// test, whose own fixture builds its surrogate with `String.fromCharCode` and
// names this defect in a comment.
//
// # Where the value is lost, which is not where it looks
//
// Not in emission, and not in the runtime. Both are correct:
//
//   - `nts_str_raw` stores UTF-16 code units and NUL-terminates both widths, so
//     a lone surrogate is representable in a compiled string.
//   - `String.fromCharCode(0xd800)` produces it correctly -- length `1` -- which
//     is the **control** that isolates the literal path from everything else.
//
// It is lost **before the snapshot**. `nts types` on this program shows
//
//     #4  Literal(String("\357\277\275\357\277\275\357\277\275"))
//     #14 Literal(String("\360\220\200\200"))
//
// where `#4` is `"\ud800"` -- three U+FFFD, EF BF BD repeated -- and `#14` is
// the *valid pair* `"𐀀"`, arriving correctly as F0 90 80 80.
//
// **That pair is the second control and it names the mechanism.** A valid
// surrogate pair is one code point and survives UTF-8; a lone surrogate is not a
// code point and cannot be encoded. Three replacement characters from the three
// WTF-8 bytes `ED A0 80` is what per-byte replacement produces, which is what Go
// does when it re-encodes invalid UTF-8 through runes.
//
// Our own decode is not the culprit and was checked: `StringTable::string` in
// `frontend-ts/src/tsgo/ast.rs` is `String::from_utf8(...)` with a
// `StringNotUtf8` error, so bytes `ED A0 80` would **fail the compile** rather
// than become replacements. The replacements arrive already made.
//
// # What a fix costs, which is why this is a blocker and not a commit
//
// `LiteralValue::String` is a Rust `String`, and a Rust `String` cannot hold a
// lone surrogate. So the repair is not a decode fix; it is a representation
// change that reaches four places:
//
//   1. tsgo's encoder, to emit a literal's cooked value as UTF-16 code units or
//      as WTF-8 rather than as a Go string coerced to valid UTF-8;
//   2. the wire protocol, to carry it;
//   3. `LiteralValue::String`, to hold it -- `Vec<u16>` or WTF-8 bytes;
//   4. every reader of it: `lower_string`, and the C, LLVM and JVM literal
//      emitters.
//
// The tempting shortcut is to re-cook the escape from the **source spelling**,
// which is plain ASCII here and does survive. Two reasons not to: it
// reimplements TypeScript's escape rules, which is a new place to disagree with
// the checker about what a literal says; and deciding *when* to do it needs a
// test like "does the cooked text contain U+FFFD", which is a check on the shape
// that is blind to a program legitimately writing U+FFFD.
//
// # Reach, measured 2026-09-24, and it argues for waiting
//
// Not an idiom in `runtime/node`. The population that matters is test262, and it
// was expected to be large there -- lone-surrogate literals are the natural way
// to test string internals. It is **19 files across `test262/test`, 5 of them
// under `test/language`**, by a grep for a `\uD800`-`\uDFFF` escape.
//
// So the measurement **lowers** this rather than raising it: 19 files against a
// four-place representation change through tsgo's encoder, the wire, the schema
// and every literal emitter. That is the right trade to decline for now, and the
// reason to write the number down is so the next reader declines it for a reason
// instead of rediscovering the cost.
//
// What would change the answer: a program that reads untrusted text into a
// literal-shaped position, or `Utf16String` growing an output direction, where a
// lone surrogate is data rather than a test case.

/** node: 1. Here: 3. */
export function lonely(): number {
  return "\ud800".length;
}

/** node: 55296. Here: 65533. */
export function code(): number {
  return "\ud800".charCodeAt(0);
}

/** The control: built at run time, and correct. Both answer 1. */
export function built(): number {
  return String.fromCharCode(0xd800).length;
}

/**
 * The second control, and the one that names the mechanism.
 *
 * A valid pair is one code point, survives UTF-8, and **agrees**. If this ever
 * disagrees too, the cause is not the encoding of lone surrogates.
 */
export function paired(): number {
  return "𐀀".length;
}
