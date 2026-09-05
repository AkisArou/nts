// Real TypeScript, timed. Node's own UTF-8 conversion, imported unmodified.
//
// Every other row in this table is either a port written for cross-language
// comparison or a probe written to ask this compiler one question. Both are
// worth having and neither is evidence about real code, because in both cases
// somebody chose the program knowing it would be measured.
//
// `runtime/node/internal/utf8.ts` was not chosen that way. It is 176 lines of
// the Node implementation in this repository, written to *be* Node, and until
// now it was compiled only for reach -- the profile asks whether it lowers and
// nothing ever ran it. Nobody writing it was thinking about this benchmark.
//
// It is also a shape no other row has: a state machine over a typed array that
// builds a string as it goes, which is what a great deal of real TypeScript
// actually looks like. `substrings` measures slicing and `strings` measures
// scanning; neither measures construction.
//
// There is no `ref.cpp` on purpose. A hand-written C++ UTF-8 decoder would have
// to reproduce this one's exact placement of U+FFFD on malformed input or the
// checksum gate rejects it, which makes it a second implementation to keep
// correct rather than a reference to divide by. The row is worth having against
// node and bun without one, and the `nts/C++` column says `--`.

import {
  utf8Decode,
  utf8Length,
  utf8Write,
} from "../../../runtime/node/internal/utf8.ts";

export function work(iterations: number): number {
  // One run of each shape the state machine branches on: ASCII, two-byte
  // Latin-1, three-byte CJK, and code points above the BMP, which are four
  // bytes in UTF-8 and a surrogate pair in UTF-16. A buffer of only ASCII
  // would measure one arm of the decoder and none of the interesting ones.
  const text =
    "the quick brown fox jumps over the lazy dog " +
    "éèêüñ précis café naïve " +
    "你好世界 こんにちは " +
    "😀🌍🚀";

  const size = utf8Length(text);
  const buffer = new Uint8Array(size);

  let total = 0;
  for (let round = 0; round < 64 * iterations; round++) {
    const written = utf8Write(buffer, text, 0, size);
    const back = utf8Decode(buffer, 0, written);
    total = total + written + back.length;
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 1;
