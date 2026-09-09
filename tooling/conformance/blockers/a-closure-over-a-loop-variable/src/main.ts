// expect: a closure over a `for` loop's own variable, which JavaScript rebinds on every iteration
//
// `for (let i = …)` gives each iteration its own binding, and a closure made in
// the body captures that iteration's `i` rather than the final value. It is the
// difference between `let` and `var` in a loop, and it is the reason `let`
// exists in loops at all.
//
// Refused. The message states the rule correctly and declines to implement it,
// which is the honest shape for a semantic that cannot be approximated -- the
// alternative is capturing one binding for all iterations, which is `var` and
// is a silently different program.
//
// # What it is beside
//
// A sweep of eight callback questions found six agreeing exactly: a callback
// reading the enclosing scope, writing an enclosing binding, called more than
// once, its return value used, taking two arguments, and one calling another.
// **Closures work.** This is the one thing about them that does not, and it is
// the one thing about them that is a rebinding rather than a capture.
//
// The other refusal in that sweep was a callback **stored and called later**,
// which is a different message and a different question -- a closure outliving
// the frame that made it.
//
// # Two controls
//
//     a closure over a `for` loop's own `let`   refuses
//     a closure over a binding declared in the body   compiles
//
// The second is the whole difference: the same closure over the same value,
// where the binding is made inside the body rather than by the loop head, is
// fine. So it is not closures in loops and not capture -- it is the loop head's
// per-iteration rebinding.

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
