// run: check
// backend: llvm

// parseInt and parseFloat skip leading white space and line terminators,
// including every Unicode space separator. nts skips ASCII white space, NBSP,
// U+FEFF, LF and CR, but not U+1680, U+2000-U+200A, U+202F, U+205F, U+3000,
// U+2028 or U+2029, and gives NaN on C, LLVM and the JVM, where Number() skips
// them. Found by the number-format-routes family.
export function probe(x: number): number {
  return parseInt("\u30007", 10) + x;
}
