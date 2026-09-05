// What a Java programmer writes for naive recursive Fibonacci: `int`.
//
// The TypeScript says `number`, and this is the row where transliterating the
// *type* instead of the *program* would be most obviously wrong. Nobody writes
// `double fib(double n)`. It is also not a gift to this lane: `fib(27)` stays
// far inside `int`, this compiler's specialization proves the same thing, and
// both sides then measure what this case is for -- call overhead and the branch
// -- rather than a conversion neither program's author intended.
//
// No `volatile` guard on `n` and none in `ref.cpp` either: the recursion is not
// something a JIT folds at a constant argument, and `fib` is the one case here
// whose cost is the calls themselves.
final class Ref {
    static int fib(int n) {
        if (n < 2) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }

    static double benchRun() {
        return fib(27);
    }
}
