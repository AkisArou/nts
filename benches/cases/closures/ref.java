// What a Java programmer writes for a function value: a lambda behind a
// single-method interface, called where it is made and again through a
// parameter that knows only the signature.
//
// **The lambda is `invokedynamic` and this backend emits none.** That is not an
// oversight to be matched: `runtime_jar.rs` asserts zero `invokedynamic` across
// the jar because `LambdaMetafactory` needs API 26 on Android, and a closure
// here is a class extending a per-descriptor `Fn$` base with a `private static
// final INSTANCE`, so that `f === f` holds. The reference should still be the
// lambda, because that is what a person writes and because the comparison is
// worth nothing if the reference adopts our constraints. If this row loses, it
// loses to `LambdaMetafactory`, and the record should say so rather than the
// reference hiding it.
//
// `int` arithmetic throughout, and it is exact rather than approximate. The
// TypeScript multiplies in f64 and then `| 0`, and for `x < 4096` the true
// product is under 2^43 and exact in a double, so `ToInt32` of it is the
// product modulo 2^32 -- which is what Java's `int` multiply computes directly.
// `x >>> 3` is `>>>` on both sides for non-negative `x`. So this is the same
// function, not a near one, and the checksum proves it.
//
// `0x9E3779B1` rather than `2654435761`, because the decimal does not fit an
// `int` literal and a `long` would change the arithmetic.
final class Ref {
    interface IntFn {
        int apply(int x);
    }

    // Not `final`, and taken through a parameter, so the JIT cannot treat
    // `drive`'s callee as a constant the way it could a static final field.
    // That is the case the second half of the TypeScript exists to measure.
    static int drive(IntFn f, int times) {
        int total = 0;
        for (int i = 0; i < times; i++) {
            total = total ^ f.apply(i);
        }
        return total;
    }

    // `volatile` for the reason `ref.cpp`'s input is: a constant seed makes
    // `mix` a pure function of `i` and the whole loop a closed form.
    private static volatile double seed = 5;

    static int work(int seed) {
        int step = seed;
        IntFn mix = x -> ((x * 0x9E3779B1) ^ (x >>> 3)) + step;

        int total = 0;
        for (int i = 0; i < 4096; i++) {
            total = total ^ mix.apply(i);
        }
        total = total + drive(mix, 4096);
        return total;
    }

    static double benchRun() {
        return work((int) seed);
    }
}
