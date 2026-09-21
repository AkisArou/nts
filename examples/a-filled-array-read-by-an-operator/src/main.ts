// An array filled by index, then **read** by a binary operator.
//
//     // # What the old binary says about this file, which is not "it fails"
//
// `nts check` on the pre-fix binary prints **`agreed on every case`** --- the
// same last line it prints now. The difference is one line up:
//
//     baseline   checked 1 cases across 1 function(s)     + 24 refusals
//     fixed      checked 6 cases across 6 function(s)
//
// Every export that depends on refused module-scope state is simply not
// compared, so the one function that does not -- `inAFunction` -- is the whole
// of the old binary's evidence, and it agreed before the fix as well. A
// fixture checked against the verdict line alone would have called this
// example a pass on both binaries and measured nothing.

// # Why every read here is at module scope
//
// TypeScript's evolving-array inference settles `[]` from the writes that
// follow it, and it can only do that where it can order the reads against
// them. Reading `xs[0]` inside an exported function is not orderable, so the
// checker gives TS7005 *implicitly has an `any[]` type* and the file does not
// compile at all -- which is the checker's answer and not this compiler's.
// So the operator reads happen where the writes are, and the exports hand back
// what they computed.

const xs = [];
xs[0] = 7;
xs[1] = 8;
const sum = xs[0] + xs[1];
const isLarger = xs[0] > 3;
const product = xs[0] * xs[1];

export function total(): number {
  return sum;
}

export function compared(): boolean {
  return isLarger;
}

export function multiplied(): number {
  return product;
}

// A read-modify-write below the prefix: slot 0 exists by the time it runs.
const accumulator = [];
accumulator[0] = 1;
accumulator[1] = 2;
accumulator[0] += 4;
const accumulated = accumulator[0];

export function afterCompoundAssignment(): number {
  return accumulated;
}

// The same through the logical family, which reads the slot to decide whether
// to write at all, and so is rejected past the prefix for the same reason.
const defaulted = [];
defaulted[0] = 3;
defaulted[0] ??= 9;
const kept = defaulted[0];

export function afterLogicalAssignment(): number {
  return kept;
}

// The function-scope spelling, which is the arm the pairing was built around.
// Both placements answer the same thing, which is the point -- and this one
// already did before the fix.
export function inAFunction(): number {
  const ys = [];
  ys[0] = 7;
  ys[1] = 8;
  return ys[0] + ys[1];
}
