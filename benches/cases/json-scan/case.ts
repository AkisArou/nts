// Real TypeScript, timed. The JSON parser's number scan, imported unmodified.
//
// The companion to `json-serialize`, and the reason it exists separately: that row measures
// clause 25.5.4, this one measures ECMA-404's number grammar, and they are different programs
// with different shapes. Serialization builds strings; scanning reads one and returns an index.
//
// `scanNumber` is the hottest loop in the parser -- 9.8% of a parse-heavy host profile, ahead of
// string reading and behind only the traversal that calls it. It walks the grammar a character
// at a time through a bounds-checked read, which is the shape this compiler's number and
// string work has to be good at.
//
// **Why this is a scan and not a parse.** `readNumber` raises `SyntaxError` on malformed input,
// and that type is not representable in this lowering, so the method is refused and could never
// appear here. The scan and the conversion are pure -- a string and an index in, a number out --
// so they are separate functions, and `scanNumber` compiles. `numberValueOf` does not: it ends
// in `Number(text)`, a conversion that is also unrefused-but-unrepresentable, and it is the
// second gap reported to MainClaude. Splitting the function is what made the difference visible:
// the frontier went *up* by one when the conversion stopped being hidden behind the refusal
// above it, which is a frontier moving forward rather than a regression.
//
// There is no `ref.cpp`. A C++ number scanner is a plausible reference in a way the escaper was
// not -- the grammar is small and unambiguous -- but it would be answering "how fast is a
// hand-written scanner" rather than "what does this compiler do with the one we ship", and the
// `nts f64` column already answers the question a reference would be for.
import { scanNumber } from "../../../runtime/web-platform/src/json/parse.ts";

export function work(iterations: number): number {
  // Every shape the grammar branches on, and the malformed ones too: a scan that only ever sees
  // well-formed input never takes the four rejection paths, and those are half the function.
  //
  // Weighted towards plain integers on purpose, because that is what documents contain. A corpus
  // of exponents and subnormals would measure the fallback and report it as the common case.
  const source =
    "0 1 -1 42 -7 100 999 12345 -98765 2147483647 " +
    "0.5 -0.25 3.14159 1e3 1E3 1e+3 1e-3 -1.5e-7 " +
    "9007199254740991 12345678901234567890 5e-324 1.7976931348623157e308 " +
    "-0 0e0 00 01 1. .5 1e 1e+ - -. +1 x";

  const length = source.length;
  let total = 0;
  for (let round = 0; round < 8 * iterations; round++) {
    let at = 0;
    while (at < length) {
      // Skip the separators by hand: the point is to time the number scan, not a tokenizer.
      const code = source.charCodeAt(at);
      if (code === 0x20) {
        at++;
        continue;
      }
      const end = scanNumber(source, at);
      if (end < 0) {
        // A rejection. Its code is part of the answer, so a scan that stopped reporting *which*
        // rule broke would change the checksum rather than pass quietly.
        total = total + end;
        at++;
        while (at < length && source.charCodeAt(at) !== 0x20) at++;
        continue;
      }
      total = total + (end - at);
      at = end;
    }
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * `volatile` in every generated driver, for the reason `node-utf8` gives: a loop-invariant
 * argument lets the optimiser hoist the whole call out of the timed region and report a zero.
 */
export const seed = 1;
