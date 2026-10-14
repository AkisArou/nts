// What a Java programmer writes for naive recursive Fibonacci: `int`.
//
// The TypeScript says `number`, and this is the row where transliterating the
// *type* instead of the *program* would be most obviously wrong. Nobody writes
// `double fib(double n)`.
//
// **The second half of that argument used to be a claim about this compiler,
// and it was false.** It said specialization proved the same thing, so both
// sides measured call overhead and the branch. Specialization narrows the
// *parameter* and not the *return* -- `fib$whole` is `(I)D`, and its recursive
// sum is a `dadd` where the loop below has an `iadd`. It is right not to: JS
// evaluates `fib(n-1) + fib(n-2)` in f64 and narrowing it would change the
// answer above 2^31. `array-methods` gets `(I)I` only because that program ends
// in `| 0` and the middle end can prove it.
//
// **What survives is the conclusion, measured rather than assumed.** Changing
// this file's `int` to `double` and nothing else makes the reference *faster*,
// 3-4% across two runs comparing minima -- so the narrow type is not a gift to
// this lane and obeying the no-field-narrower-than-f64 rule here would move the
// row against us. That is an argument for obeying it, not against, and it is
// recorded with its numbers in `benches/jvm-rows.md` as a decision not yet
// taken.
//
// No `volatile` guard on `n` and none in `ref.cpp` either: the recursion is not
// something a JIT folds at a constant argument, and `fib` is the one case here
// whose cost is the calls themselves.
final class Ref extends Bench.Work {
    static int fib(int n) {
        if (n < 2) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }

    @Override public double run() {
        return fib(27);
    }
}
