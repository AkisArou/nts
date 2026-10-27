// What a careful Java programmer writes for case conversion:
// `toLowerCase(Locale.ROOT)` (see `case-convert`'s reference for why the
// locale argument is not optional).
//
// Already-cased ASCII through the matching direction; the same savings are available to Java, which also returns the argument when nothing changed.
//
// The inputs are built once and indexed, as the TypeScript does, so the
// conversion is measured and the concatenation is not.
import java.util.Locale;

final class Ref extends Bench.Work {
    // `volatile` so the strings are not compile-time constants.
    private static volatile double seed = 3;

    static int convert(int seed) {
        String[] lowers = new String[16];
        String[] uppers = new String[16];
        for (int i = 0; i < 16; i++) {
            lowers[i] = "the quick brown fox jumps over the lazy dog " + Integer.toString(seed) + Integer.toString(i);
            uppers[i] = "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG " + Integer.toString(seed) + Integer.toString(i);
        }

        int total = 0;
        for (int round = 0; round < 64; round++) {
            String lower = lowers[round % 16].toLowerCase(Locale.ROOT);
            String upper = uppers[round % 16].toUpperCase(Locale.ROOT);
            total = total + lower.length() + upper.length();
            total = total + lower.charAt(0) + upper.charAt(0);
        }
        return total;
    }

    @Override public double run() {
        return convert((int) seed);
    }
}
