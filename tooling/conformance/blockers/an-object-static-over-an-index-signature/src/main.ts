// expect: NTS1001 an `Object` static over something that is not an object here is not supported by this lowering yet
//
// `Object.entries(marks)` over a `Record<number, string>`, as the Scale
// corpus port iterates its marks. An index signature is a table, not
// an object with named fields here, and the static refuses it.
// Measured with the compiler built from main d753577a6 (this tree).
//
// Control beside it, which must stay clean: `Object.entries` over an
// object with named fields, which lowers today.
export function demo(): string {
  const marks: Record<number, string> = { 0: "a", 1: "b" };
  let out = "";
  for (const [value, label] of Object.entries(marks)) { out += value + label; }
  return out;
}

export function control(): string {
  const marks = { a: "x", b: "y" };
  let out = "";
  for (const [key, label] of Object.entries(marks)) { out += key + label; }
  return out;
}
