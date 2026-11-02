// run: check
// backend: jvm

// String() of an object literal whose toString() captures a variable must call
// that method. On C, LLVM and the JVM it gives another string, while the same
// literal with a toString() that captures nothing is converted correctly. The
// second shape of an-interface-to-string-skipped-by-string-conversion, found
// while reducing template-routes substitution-to-string-mutation-fields.
export function probe(n: number): number {
  const shown = { toString(): string { return "own" + String(n); } };
  return String(shown) === "own" + String(n) ? 1 : 0;
}
