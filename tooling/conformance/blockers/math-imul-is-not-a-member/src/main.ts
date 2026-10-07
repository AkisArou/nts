// expect: nothing refused -- FIXED, kept as a guard
//
// **FIXED 2026-10-07 (`Math.imul`), and kept as a guard**: a runtime helper,
// `nts_math_imul`, exact on every lane; examples/math-imul-multiplies-in-32-bits
// checks it against node on C, C+RC, LLVM and JVM. What follows is the
// fixture as it was written.
//
// `Math.imul` (ES2015) is refused. It is the 32-bit multiply every string
// hash written for JavaScript uses -- FNV-1a, Murmur, xxhash's JS ports --
// because `*` on two 32-bit values loses bits above 2^53. Found 2026-10-07 in
// the Chromium lane, hashing a canvas's PNG in tests/idl-vectors.ts
// (runtime/chromium/contracts/workarounds.md, 22).
//
// Control, one difference -- `Math.trunc` in the same position:
//
//     hash = Math.trunc(hash ^ text.charCodeAt(i)) >>> 0;
//
// compiles.

export function fnv(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash;
}
