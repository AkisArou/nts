// expect: a closure over a `for` loop's own variable that the loop's body also writes
//
// # The boundary moved on 2026-09-13, and this fixture moved with it
//
// This used to hold "a closure over a `for` loop's own variable" outright, with
// the reasoning that the per-iteration rebinding cannot be approximated and the
// alternative — one binding for all iterations — is `var` and a silently
// different program. That reasoning is correct and it was being applied to the
// wrong set.
//
// **Copying is exact on the common shape, not an approximation of it.** The
// specification copies the binding before each iteration and runs the increment
// in the copy, so iteration k's binding keeps iteration k's value for ever. A
// closure built in the body and reading `i` must see that value, and the value
// `i` holds where the closure is built *is* that value.
//
// The old rule refused by asking whether the name was written **anywhere**, and
// a counter is written by its own `i++` in every loop ever written. So it
// refused every loop to catch the rare one, and `examples/a-closure-over-a-loop-
// variable` is the three shapes that now compile and agree with node.
//
// # What is left, and it is a real difference
//
//     for (let i = 0; i < 3; i++) { fns.push(() => i); i += 10; }
//
// The body's write lands in the binding the closure is already holding. node
// answers 10 for `fns[0]()`; a copy answers 0. That is the case below, and it
// is the whole of what the original refusal was ever protecting.
//
// # Three controls
//
//     the body writes the loop's own variable       refuses
//     the body writes something else                compiles, agrees on 87 cases
//     a binding declared in the body                compiles
//
// The second is the one that changed. The third was always fine and is kept
// because it is the arm that says the loop head is what matters: the same
// closure over the same value, where the binding is made inside the body, was
// never in question.

/** Under test: the body writes the loop's own variable after the capture. */
export function bodyWritesIt(): number {
  let total = 0;
  const run = (f: () => void): void => {
    f();
  };
  for (let i = 0; i < 3; i++) {
    run(() => {
      total += i;
    });
    i += 10;
  }
  return total;
}

/** The control that changed: the body writes `total`, not `i`. */
export function sumOfCaptures(): number {
  let total = 0;
  const run = (f: () => void): void => {
    f();
  };
  for (let i = 1; i <= 3; i++) {
    run(() => {
      total += i;
    });
  }
  return total;
}

/** The control that never moved: the binding is made inside the body. */
export function bindingInTheBody(): number {
  let total = 0;
  const run = (f: () => void): void => {
    f();
  };
  for (let i = 1; i <= 3; i++) {
    const held = i;
    run(() => {
      total += held;
    });
  }
  return total;
}
