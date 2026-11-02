// run: check
// backend: jvm

// String() and a template substitution of a value whose declared type is an
// interface with its own toString() must call that method. On C, LLVM and the
// JVM they give another string, though calling .toString() through the same
// interface is right, and so is String() of the same object typed by its
// literal type or of a class instance. Found by template-routes
// substitution-to-string-mutation-fields, whose control fails the same way.
interface Shown { toString(): string }
export function probe(n: number): number {
  const shown: Shown = { toString() { return "own"; } };
  return String(shown) === "own" ? 1 : 0;
}
