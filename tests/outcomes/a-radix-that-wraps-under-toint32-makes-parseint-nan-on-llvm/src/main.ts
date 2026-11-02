// run: check
// backend: llvm

// parseInt converts its radix with ToInt32, so 2^32 + 16 is radix 16, -2^32 + 2
// is radix 2, and Infinity is 0, which reads "0x" as hexadecimal. nts gives
// NaN for each on C, LLVM and the JVM. Found by the number-format-routes family.
export function probe(r: number): number {
  return parseInt("10", 4294967312) + r;
}
