// Control for a-capturing-to-string-skipped-by-string-conversion: the same conversion of a toString() that captures nothing.
function render(tag: string): string {
  const shown = { toString(): string { return "own"; } };
  return String(shown) + tag;
}
observe("String calls a capturing toString", String(render("1") === "own1"));
done();
