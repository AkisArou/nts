// An erased array that must NOT be specialized.
//
// `unerase::narrow_arrays` retypes an `unknown[]` to its element's
// representation when every store is the same kind. Here they are not: half
// the elements are numbers and half are strings, so the array genuinely needs
// a tag per element and narrowing it would read a string's pointer as a
// double.
//
// The positive case is `benches/cases/erasure-stored-unknown`, whose gap
// against the typed control closed to nothing. This is the case that keeps
// that from being achieved by assuming.
export function mixed(n: number): number {
  const values: unknown[] = new Array(8);
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) {
      values[i] = n + i;
    } else {
      values[i] = "odd";
    }
  }
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const held = values[i];
    if (typeof held === "number") {
      total = total + held;
    }
  }
  return total;
}
