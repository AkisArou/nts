// run: check
// backend: llvm

// A Record<string, string> read at a key nobody wrote is undefined in node, so
// the `=== undefined` test is true and the slot is filled. nts answers the test
// false from the declared value type and returns the absent value; a program
// that then uses it as a key exits abnormally on C and LLVM, and with a
// NullPointerException on the JVM. Found by the symbol-routes controls.
export function probe(n: number): number {
  const registry: Record<string, string> = {};
  const slot = "k" + String(n);
  if (registry[slot] === undefined) registry[slot] = "made";
  return registry[slot] === "made" ? 1 : 0;
}
