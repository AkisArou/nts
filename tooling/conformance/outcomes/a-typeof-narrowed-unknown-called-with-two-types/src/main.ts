// The control for an-unknown-narrowed-by-typeof-called-with-one-type,
// differing in one thing: a second caller, passing a string. The parameter
// stays erased, both branches are live, and the program agrees with node.
function describe(value: unknown): string {
  if (typeof value === "number") {
    return "n" + String(value);
  }
  if (typeof value === "string") {
    return "s" + value;
  }
  return "other";
}
observe("described", describe(7));
observe("described text", describe("x"));
done();
