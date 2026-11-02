// A Record<string, string> read at a key nobody wrote is undefined in node, so
// the `=== undefined` test is true and the slot is filled. nts answers the test
// false from the declared value type and returns the absent value; a program
// that then uses it as a key exits abnormally on C and LLVM, and with a
// NullPointerException on the JVM. Found by the symbol-routes controls.
const registry: Record<string, string> = {};
function lookup(slot: string): string {
  if (registry[slot] === undefined) registry[slot] = "made:" + slot;
  return registry[slot];
}
observe("first lookup made", String(lookup("a") === "made:a"));
observe("second lookup made", String(lookup("a") === "made:a"));
done();
