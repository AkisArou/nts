// What a Java programmer writes when the function value is chosen at runtime:
// two lambdas behind one single-method interface, merged into one variable and
// called at one site.
//
// **The lambda is `invokedynamic` and this backend emits none**, for the reason
// `closures/ref.java` gives at length. The reference should still be the
// lambda, because that is what a person writes, and because a comparison is
// worth nothing if the reference adopts our constraints.
//
// The merge is the point, so it is written the way the TypeScript is: an
// `if`/`else` assigning to a declared local, not a conditional expression and
// not two separate call sites. A single site that sees two implementations is
// what makes this bimorphic, and bimorphic is what C2 has a mechanism for --
// two guarded direct calls rather than a virtual dispatch. If this row beats
// `closures`'s ratio, that mechanism is why.
//
// `int` arithmetic throughout and exact rather than approximate, by the
// argument `closures/ref.java` makes: for `x < 512` the true product is far
// under 2^53 and exact in a double, so `ToInt32` of it is the product modulo
// 2^32, which is what an `int` multiply computes directly. Verified rather than
// argued -- this and the TypeScript and the C++ all answer 467775488.
//
// `0x9E3779B1` rather than `2654435761`, because the decimal does not fit an
// `int` literal and a `long` would change the arithmetic.
final class Ref extends Bench.Work {
    interface IntFn {
        int apply(int x);
    }

    // Taken through a parameter, so the JIT cannot treat the callee as a
    // constant -- the same bar `closures` sets for its second half.
    static int drive(IntFn f, int times) {
        int total = 0;
        for (int i = 0; i < times; i++) {
            total = total ^ f.apply(i);
        }
        return total;
    }

    // `volatile` for the reason every case here has it: a constant seed makes
    // the whole loop a closed form the optimiser can hoist out of the timing.
    private static volatile double seed = 5;

    static int work(int seed) {
        int step = seed;
        int total = 0;
        for (int round = 0; round < 8; round++) {
            IntFn mix;
            if ((round & 1) == 0) {
                mix = x -> ((x * 0x9E3779B1) ^ (x >>> 3)) + step;
            } else {
                mix = x -> ((x * 40503) ^ (x >>> 5)) - step;
            }
            for (int i = 0; i < 512; i++) {
                total = total ^ mix.apply(i);
            }
            total = total + drive(mix, 512);
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
