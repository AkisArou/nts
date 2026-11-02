// String() of an object literal whose toString() captures a variable must call
// that method. On C, LLVM and the JVM it gives another string, while the same
// literal with a toString() that captures nothing is converted correctly. The
// second shape of an-interface-to-string-skipped-by-string-conversion, found
// while reducing template-routes substitution-to-string-mutation-fields.
function render(tag: string): string {
  const shown = { toString(): string { return "own" + tag; } };
  return String(shown);
}
observe("String calls a capturing toString", String(render("1") === "own1"));
done();
