// What a Java programmer writes to turn an `int` into digits:
// `Integer.toString`.
//
// This is the row where the two lanes are doing genuinely different work and
// the reference is the fair one anyway. `runtime/jvm` carries a port of
// `nts_grisu.h` rather than calling `Double.toString`, because Java's format is
// not JavaScript's -- `1.0E21` against `1e21` -- and because it has differed
// between JDKs. So we ship a formatter and the reference calls the platform's.
//
// On this case every value is an `int32`, so the reference gets
// `Integer.toString`, which is a specialised digit loop and about as good as
// that operation gets on the JVM. That is the right comparison: a person
// formatting an integer calls the integer overload, and if our formatter is
// slower than a well-tuned one the row should say so.
//
// Every character is summed rather than the length read, for the reason the
// TypeScript gives: a digit *count* can be produced without building the
// string, and node was measured eliding exactly that.
final class Ref extends Bench.Work {
    // `volatile` so the digits are not compile-time constants.
    private static volatile double seed = 3;

    static int format(int seed) {
        int total = 0;
        for (int round = 0; round < 64; round++) {
            int small = round + seed;
            int wide = round * 7919 + seed;
            int negative = 0 - wide;

            String a = Integer.toString(small);
            String b = Integer.toString(wide);
            String c = Integer.toString(negative);
            for (int k = 0; k < a.length(); k++) {
                total = total + a.charAt(k);
            }
            for (int k = 0; k < b.length(); k++) {
                total = total + b.charAt(k);
            }
            for (int k = 0; k < c.length(); k++) {
                total = total + c.charAt(k);
            }
        }
        return total;
    }

    @Override public double run() {
        return format((int) seed);
    }
}
