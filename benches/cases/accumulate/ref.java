// What a Java programmer writes for a masked accumulation: `int` for both the
// hash and the total.
//
// The total is where this row has something to say. The TypeScript comment
// explains that `total` stays a *double* in the compiled program: interval
// analysis alone sends a counted loop's accumulator to infinity, an infinite
// bound is not a whole number, so nothing proves the sum is an integer even
// though 4096 iterations of a value masked to 255 obviously cannot exceed
// 1,044,480.
//
// A Java programmer writes `int total` without pausing, because a person counts
// the iterations. So this reference is harder than what we emit, and
// deliberately: the gap is a real limitation of the range analysis, upstream of
// this backend, and the row should show it rather than be written around it.
// The same call as `dispatch`'s `int[]`.
//
// The `| 0`s are dropped because in Java the type is the proof.
final class Ref {
    // `volatile` so the loop is not a compile-time constant.
    private static volatile double seed = 12345;

    static int accumulate(int seed) {
        int h = seed;
        int total = 0;
        for (int i = 0; i < 4096; i++) {
            h = h * 31 + i;
            total += h & 255;
        }
        return total;
    }

    static double benchRun() {
        return accumulate((int) seed);
    }
}
