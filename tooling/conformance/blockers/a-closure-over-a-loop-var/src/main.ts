// expect: a closure over a `for` loop's `var`, which JavaScript does not rebind per iteration
//
// `for (var i = …)` has **one binding for the whole loop**. A closure made in
// the body and read afterwards sees the value the loop ended on — 3, not 0 —
// which is the opposite of what `let` gives and the reason `let` exists.
//
// # Why this is a fixture rather than a line in the `let` one
//
// Until 2026-09-13 both were refused by one rule, which walked from the
// declaration up to the enclosing `for` without asking which keyword wrote it.
// That was written down at the time as an over-refusal costing nothing, with
// the measurement beside it: seven `var` declarations in `runtime/node`, all of
// them `declare global` ambients, none in a loop, and none at all in
// `examples/`.
//
// When the `let` case was narrowed to capture by value — which is *exact* for
// `let`, not an approximation — that shared rule was the only thing standing
// between `var` and a wrong answer that runs. A copy answers 0 where node
// answers 3, and every arm of the `let` example calls its closure immediately,
// where the two agree. **The over-refusal was load-bearing and nothing said
// so.**
//
// # Why it still refuses rather than using the cell it already has
//
// A single cell shared by the whole loop may well be exactly right for `var`,
// since that is what the semantics are. It is unmeasured, and with zero sites
// in the corpus there is nothing to check an implementation against — and
// "probably right, untested" is not a reason to stop refusing something.
//
// # Two controls
//
//     the same loop with `let`      compiles, and agrees with node
//     a binding declared in the body   compiles
//
// The first is the one that matters: it is the same program with one keyword
// changed, so a compiler that refused both for one reason and a compiler that
// tells them apart are distinguishable here and nowhere else.

/** Under test. */
export function varLoop(): number {
  let total = 0;
  const run = (f: () => void): void => {
    f();
  };
  for (var i = 0; i < 3; i++) {
    run(() => {
      total += i;
    });
  }
  return total;
}

/** The control: one keyword different. */
export function letLoop(): number {
  let total = 0;
  const run = (f: () => void): void => {
    f();
  };
  for (let i = 0; i < 3; i++) {
    run(() => {
      total += i;
    });
  }
  return total;
}

/** The control that was never in question. */
export function bindingInTheBody(): number {
  let total = 0;
  const run = (f: () => void): void => {
    f();
  };
  for (let i = 0; i < 3; i++) {
    const held = i;
    run(() => {
      total += held;
    });
  }
  return total;
}
