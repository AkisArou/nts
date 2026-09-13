// expect: emit-jvm -> storing a `Fn__3` where a `Closure0` is declared
//
// A closure that **outlives the iteration that made it**, which is the only
// shape that can tell capture-by-value from one shared cell.
//
// # Why this fixture exists at all
//
// On 2026-09-13 a closure over a `for` loop's own variable stopped being
// refused and started being captured by value, which is exact for `let`:
// the specification copies the binding before each iteration, so iteration k's
// binding keeps iteration k's value, and that value is what `i` holds where the
// closure is built.
//
// `examples/a-closure-over-a-loop-variable` guards it on C and LLVM. Every arm
// there calls its closure **immediately**, and an immediately-called closure
// sees the same `i` under either implementation — so those arms agree whichever
// way the compiler does it, and prove nothing about which way it did.
//
//     called in the loop     value capture 0,1,2   one cell 0,1,2   same
//     called after it        value capture 0       one cell 3       different
//
// This is the second row, and it is the whole evidence.
//
// # Why it is here rather than in the example
//
// It declines on the JVM, and not for anything to do with loops. `held` is
// assigned two different closures, so a `Fn__3` is stored where a `Closure0` is
// declared and `Layout.base` does not relate them — the same family as
// `a-closure-with-fewer-parameters-than-its-slot`, which is this message with
// the two operands the other way round.
//
// Putting it in the example would have failed that backend's floor, which
// equals the corpus and so cannot ratchet. Deleting the arm to make three
// backends agree would have taken **the only thing that asks the question** —
// which is the argument that lane's own floor comment makes about
// `a-unary-plus-is-a-conversion`, and it applies here unchanged.
//
// So it is filed, not trimmed. It agrees with node on C and LLVM today; when
// the relation lands it goes back into the example.
//
// # Two controls, both in the example
//
//     the same closure called inside the loop   agrees on all three backends
//     `for (let x of xs)` read by a closure     agreed even before the change
//
// The second is the one that says the old rule was about *assignment* rather
// than about loops: `x` is never written, so it was never caught.

export function deferredOne(n: number): number {
  let held: () => number = () => 0;
  for (let i = 0; i < 3; i++) {
    if (i === 0) {
      held = () => i;
    }
  }
  return (n & 7) + held();
}
