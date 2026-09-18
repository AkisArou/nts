// `try`, `for…in` and a labelled statement, at module scope.
//
// All three lowered inside a function body from the beginning -- `lower_try`,
// `lower_for_of` with `Over::Keys`, `lower_labeled` -- and all three were
// refused at module scope, because `is_module_statement` is an allow-list and
// they were not on it. Nothing decided that; the list was three entries short
// of its own lowering, and the refusal read as though the construct were
// unsupported:
//
//   NTS1001 a `for...in` statement, which has code in it is not supported by
//   this lowering yet
//
// An allow-list is the right shape here -- a kind that is on neither list is
// refused rather than silently skipped, which is the defect it was written to
// fix, when `total = bump(41)` at module scope was dropped and the program ran
// as though the line were not there. What it needs is to be complete.
//
// `examples/a-labelled-block` and `examples/a-for-in-over-an-object` carry the
// function-body forms. This is the same three constructs one scope out, which
// is a different code path and was answering 0 for all three.

// A `try` with all three parts: the body runs, the throw lands in `catch`, and
// `finally` runs after it. A compiler that skipped the statement answers 0, and
// one that ran the body but not the handler answers 11.
let tried = 0;
try {
  tried = 1;
  throw new Error("x");
} catch {
  tried = 2;
} finally {
  tried = tried + 10;
}

// `for…in` over an object's own keys. Summed rather than counted, so a walk
// that visits the right number of keys with the wrong values still fails.
let seen = 0;
const holder: Record<string, number> = { a: 1, b: 2, c: 3 };
for (const key in holder) {
  seen = seen + holder[key];
}

// A labelled `continue` targeting the outer loop, which is the form that needs
// the label: `continue` alone would give 0 here, and no `continue` at all gives
// 25. So the three ways to be wrong are three different numbers.
let labelled = 0;
outer: for (let i = 0; i < 5; i = i + 1) {
  for (let j = 0; j < 5; j = j + 1) {
    if (j === 2) {
      continue outer;
    }
    labelled = labelled + 1;
  }
}

export function readTried(): number {
  return tried;
}

export function readSeen(): number {
  return seen;
}

export function readLabelled(): number {
  return labelled;
}
