// What a Java programmer writes for `||=`: an `if`.
//
// Java has no logical-assignment operator, so the reference spells out what
// `cached ||= step + 1` means -- assign when the current value is falsy. Here
// `cached` is `seed & 3`, an `int` in 0..3, so falsy is exactly zero and the
// translation is total rather than approximate. On a value that could be NaN or
// an empty string it would not be, and that is a reason this row is about the
// operator on a number and not about truthiness in general.
//
// `int` throughout, and the wrap is load-bearing: the TypeScript writes
// `(total + cached) | 0` and the sum passes 2^31 well before 100,000 rounds, so
// both sides wrap at 32 bits and agree because they wrap the same way. A `long`
// accumulator would be a different program and the checksum would say so.
final class Ref {
    // `volatile` so the trip count is not a compile-time constant.
    private static volatile double rounds = 100000;

    static int run(int rounds) {
        int total = 0;
        int seed = rounds;
        for (int i = 0; i < rounds; i = i + 1) {
            int step = i;
            seed = seed * 31 + step;
            int cached = seed & 3;
            if (cached == 0) {
                cached = step + 1;
            }
            total = total + cached;
        }
        return total;
    }

    static double benchRun() {
        return run((int) rounds);
    }
}
