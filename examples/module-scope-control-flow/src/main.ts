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

// A labelled **block** with `break label`, which is a different construct from
// the labelled loop above: there is nothing to continue, only somewhere to
// leave. It **panicked the compiler** at module scope — `no entry found for
// key`, from `carried_now` indexing the binding table for a name that is a
// global.
//
// Three constructs carry names across their arms — a loop, a `switch`, and a
// labelled block — and each collects them with `assigned_symbols`. Only the
// loop filtered globals out. The other two indexed the table directly and died,
// and both were found on the same evening by running module-scope statements
// against node rather than by reading the code. `carried_locals` is the one
// place that decides it now.
let left = 0;
leave: {
  left = 1;
  if (left === 1) {
    break leave;
  }
  left = 2;
}

// The same construct with a *local* beside the global: one is carried out of
// the block and the other is not, which a filter that took all or nothing would
// get wrong.
let mixedOut = 0;
both: {
  const inner = 4;
  mixedOut = inner;
  if (mixedOut > 0) {
    break both;
  }
  mixedOut = 9;
}

export function readLeft(): number {
  return left;
}

export function readMixedOut(): number {
  return mixedOut;
}

// A label may attach to **any** statement, not only to a loop or a block.
//
// `lbl: n = 1;`, `lbl: if (c) { … }` and `lbl: try { … } finally { … }` are all
// legal, and `break lbl` leaves them. `lower_labeled` had an allow-list of five
// kinds and refused everything else as *a label on something that is not a
// loop* — 14 files in the slice-1 `test/language` population, most of them in
// `asi` and `statementList`, where a label on an expression statement is the
// subject of the test rather than incidental to it.
//
// Only `continue` needs a loop, and the shape a non-loop label gets has no
// latch — so the checker's rejection of `continue` to such a label is backed by
// there being nothing to continue to.
//
// `for…in` was missing from that list as well, so a labelled `for…in` refused
// while the same loop written `for…of` compiled. `lower_for_of` handles both,
// through its `Over::Keys` arm; only the list did not say so.

let labelledExpression = 0;
byName: labelledExpression = 1;

let labelledIf = 0;
overIf: if (1 > 0) {
  labelledIf = 1;
  break overIf;
}

let labelledTry = 0;
overTry: try {
  labelledTry = 1;
} finally {
  labelledTry = labelledTry + 1;
}

let labelledForIn = 0;
const keyed: Record<string, number> = { a: 1, b: 2, c: 3 };
overKeys: for (const key in keyed) {
  if (keyed[key] === 2) {
    continue overKeys;
  }
  labelledForIn = labelledForIn + 1;
}

export function readLabelledExpression(): number {
  return labelledExpression;
}

export function readLabelledIf(): number {
  return labelledIf;
}

export function readLabelledTry(): number {
  return labelledTry;
}

export function readLabelledForIn(): number {
  return labelledForIn;
}
