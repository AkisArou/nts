// What a Java programmer writes for a small value object allocated in a loop:
// a class with a constructor and a method, allocated per iteration, exactly as
// the TypeScript says.
//
// **This reference deliberately does not do what `ref.cpp` does.** C++ has
// value types, so its `Vec2` is a stack struct and the loop allocates nothing;
// there is no such thing in Java, where `new` is the only way to make one and
// every `Vec2` is a heap reference until the JIT proves otherwise. Writing a
// pair of loose `double` locals here to imitate the C++ would be a reference
// that answers a different question -- and it would answer it in our favour,
// because the compiled program allocates too.
//
// So this row asks the question the plan reserved for it: does C2 scalar
// replace a `Vec2` that does not escape? Both lanes allocate in the source and
// the ratio says whether the JIT treats the two allocations alike. `bytes/op`
// under `NTS_BENCH_ALLOC=1` is the direct reading; this is the timed one.
//
// The fields are `final`, which is what a Java programmer writes and what this
// backend cannot emit: a generated `<init>()V` runs before the constructor
// body, so a `putfield` to a final field would be outside `<init>` and throw
// `IllegalAccessError` on JDK 9 and up. That asymmetry is in the reference's
// favour and is left there on purpose -- the flag is a real thing a person
// writing this by hand gets, and a reference that gave it up to match our
// constraint would be measuring our constraint instead of our codegen.
final class Ref extends Bench.Work {
    static final class Vec2 {
        final double x;
        final double y;

        Vec2(double x, double y) {
            this.x = x;
            this.y = y;
        }

        double dot(Vec2 other) {
            return x * other.x + y * other.y;
        }
    }

    // `volatile` for the reason `ref.cpp`'s `volatile double seed = 3` is: a
    // constant seed lets the JIT fold `base` and then the whole loop.
    private static volatile double seed = 3;

    static double simulate(double seed) {
        Vec2 base = new Vec2(seed, seed + 1);
        double total = 0;
        for (int i = 0; i < 4096; i++) {
            Vec2 point = new Vec2(i, i + 1);
            total = total + point.dot(base);
        }
        return total;
    }

    @Override public double run() {
        return simulate(seed);
    }
}
