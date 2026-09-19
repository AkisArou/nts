// `xs[xs.length] = v` extends an array, and this compiler **aborted**.
//
//     nts: refused: index 1 is outside [0, 1)
//
// Not a refusal — an abort, so there was no diagnostic, no artifact and nothing
// naming the construct. Filling an array by index is how
// `var xs = []; xs[0] = a; xs[1] = b;` is written, and it is 26 files of the
// slice-1 `test/language` population on its own.
//
// # By one, and why not further
//
// `xs[5] = v` on a length-1 array wants four holes, and a hole reads as
// `undefined` — which a dense array of numbers has no room for. Filling them
// with the element's zero would be a silent wrong answer, so a sparse write
// still aborts. `sparseStillAborts` is not written here for that reason: an
// example arm that disagrees with node is a known failure rather than a
// fixture, and the ledger row carries it instead.
//
// # Where the cost went
//
// `bounds.rs` already eliminates a checked `ArraySet` over the interval domain,
// so the growth rides on exactly the proof the bounds check rides on: an index
// proven in range has no check *and* no growth, and one that is not already
// paid for a check. `inBounds` and `counted` below are the arms that must keep
// their eliminated checks, and `compiler/core/tests/bounds_checks.rs` is what
// fails if they do not.
//
// # The length fact, which is the whole of the difficulty
//
// `allocated_length_is_exact` lets `[1, 2, 3].length` fold to 3, and that is
// what proves an index into a literal in bounds by the interval alone. A store
// that grows makes the claim false after it.
//
// Invalidating the claim for any array with a checked store was tried and broke
// `total` in `examples/arrays` — which has no store the source wrote at all.
// Its literal's *own* initialising stores are `ArraySet`s, and they cannot grow
// anything: `ArrayNew` made the slots and each store names one by a constant.
// Excluding exactly those is what makes the rule precise, and `squares` then
// keeps every eliminated check because its `xs[i] = i * i` is proven by the
// guard relation rather than by the constant length.

/** The append: an index one past the end extends the array. */
export function appended(n: number): number {
  const xs: number[] = [n];
  xs[1] = n + 1;
  return xs.length * 1000 + xs[0] * 10 + xs[1];
}

/** Filling an empty array, which is what the corpus writes. */
export function filled(n: number): number {
  const xs: number[] = [];
  xs[0] = n;
  xs[1] = n + 1;
  xs[2] = n + 2;
  return xs.length * 1000 + xs[2];
}

/** Through a parameter, where no length was ever claimed exact. */
function fill(xs: number[], n: number): number {
  xs[xs.length] = n;
  return xs.length;
}

export function throughAParameter(n: number): number {
  const xs: number[] = [];
  return fill(xs, n) * 10 + xs[0];
}

/** Booleans grow too: a boolean array is its own storage width, not a number's. */
export function booleans(n: number): number {
  const flags: boolean[] = [];
  flags[0] = n > 0;
  return flags.length * 10 + (flags[0] ? 1 : 0);
}

/** **Control.** An in-bounds write, which was never checked and must stay so. */
export function inBounds(n: number): number {
  const xs: number[] = [1, 2];
  xs[1] = n;
  return xs.length * 10 + xs[1];
}

/** **Control.** A counted loop whose checks `bounds.rs` eliminates. */
export function counted(n: number): number {
  const xs: number[] = [0, 0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    xs[i] = i * n;
  }
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i]!;
  }
  return sum;
}
