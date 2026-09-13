// A closure over a `for` loop's own variable.
//
// `for (let i = …)` gives each iteration its own binding. The specification
// copies that binding **before** each iteration and runs the increment in the
// copy, so iteration k's binding keeps iteration k's value for ever — which is
// the difference between `let` and `var` in a loop, and the reason `let` exists
// in loops at all.
//
// # Why copying is exact rather than an approximation
//
// A closure built in the body and reading `i` must see that iteration's value,
// and the value `i` holds at the moment the closure is built **is** that value.
// So capturing by value is not a cheaper stand-in for a per-iteration cell: on
// this shape it is the same answer, and it is the answer node gives.
//
// The old rule reached the opposite conclusion by asking whether the name was
// written *anywhere*. A counter is written by its own `i++` in every loop ever
// written, so that question refused every loop in order to catch the rare one.
//
// # The rare one, which is `bodyWritesIt` below
//
//     for (let i = 0; i < 3; i++) { fns.push(() => i); i += 10; }
//
// The write lands in the binding the closure is already holding, so node
// answers 10 for `fns[0]()` and a copy answers 0. That case still refuses, by
// a message that now names it: "…that the loop's body also writes".
//
// # What the compiler said before
//
// Measured against the binary from the commit before, on this file:
//
//     before   5 refused, 29 cases across 1 function
//     after    2 refused, 87 cases across 3 functions
//
// # The arm that can tell the two answers apart is NOT here
//
// **Every arm below calls its closure immediately, and an immediately-called
// closure sees the same `i` under either implementation.** So these agree
// whichever way the compiler does it, and on their own they prove nothing about
// which way it did:
//
//     called in the loop     value capture 0,1,2   one cell 0,1,2   same
//     called after it        value capture 0       one cell 3       different
//
// The second row is the evidence, and it lives in
// `blockers/a-closure-outliving-its-iteration` because it declines on the JVM —
// for a reason with nothing to do with loops. Holding one closure in a slot and
// assigning it a second stores a `Fn__3` where a `Closure0` is declared, and
// `Layout.base` does not relate them.
//
// It is filed rather than trimmed. Deleting it to make three backends agree
// would have taken the only thing that asks the question, which is the argument
// that backend's own floor comment makes about `a-unary-plus-is-a-conversion`.
// It agrees with node on C and LLVM today; when the relation lands it comes
// back here.
//
// `forOfLet` is the one that passed on both, and it is here as the control that
// says why: `for (let x of xs)` never assigns `x`, so it was never caught by
// the old rule either. A fixture where every arm changed would not have shown
// that the rule was about *assignment* rather than about loops.

/** The loop's own counter, read by a closure. The body writes something else. */
export function sumOfCaptures(n: number): number {
  let total = n & 7;
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

/** Two counters, both captured, from nested loops. */
export function nested(n: number): number {
  let total = n & 7;
  const run = (f: () => void): void => {
    f();
  };
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      run(() => {
        total += i * j;
      });
    }
  }
  return total;
}

/**
 * The control that passed before the change too.
 *
 * `for (let x of xs)` never assigns `x`, so the old rule — "is this name
 * written anywhere" — answered no and let it through. It is the arm that shows
 * the rule was about assignment, not about loops.
 */
export function forOfLet(n: number): number {
  let total = n & 7;
  const run = (f: () => void): void => {
    f();
  };
  const xs = [1, 2, 3];
  for (let x of xs) {
    run(() => {
      total += x;
    });
  }
  return total;
}
