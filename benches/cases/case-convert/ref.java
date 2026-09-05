// What a careful Java programmer writes for case conversion:
// `toLowerCase(Locale.ROOT)`.
//
// **The locale argument is not optional and the bare call is a bug**, which is
// why this reference passes it and why the plan refuses `String.toLowerCase` as
// an implementation of the TypeScript operation. Without a locale Java uses the
// default one, and in Turkish `"I".toLowerCase()` is a dotless ı -- a
// famously load-bearing difference that has broken case-insensitive comparisons
// in real software. JavaScript's `toLowerCase` is locale-independent, so
// `Locale.ROOT` is the one that means the same thing.
//
// Even with the locale pinned the two are not the same function. Java's
// `toUpperCase` maps the German ß to SS and grows the string; JavaScript's
// does too, so that one agrees, but final sigma and a handful of other
// conditional mappings differ. This case is ASCII plus a decimal digit, so
// none of it can appear here and the checksum confirms it -- which is exactly
// why `runtime/jvm` generates its case tables from QuickJS's `libunicode`
// rather than calling the platform: a benchmark that agrees on ASCII is not
// evidence about a language.
//
// The inputs are built once and indexed, as the TypeScript does, so the
// conversion is measured and the concatenation is not.
import java.util.Locale;

final class Ref {
    // `volatile` so the strings are not compile-time constants.
    private static volatile double seed = 3;

    static int convert(int seed) {
        String base = "The Quick Brown Fox Jumps Over The Lazy Dog " + Integer.toString(seed);
        String[] inputs = new String[16];
        for (int i = 0; i < 16; i++) {
            inputs[i] = base + Integer.toString(i);
        }

        int total = 0;
        for (int round = 0; round < 64; round++) {
            String s = inputs[round % 16];
            String lower = s.toLowerCase(Locale.ROOT);
            String upper = s.toUpperCase(Locale.ROOT);
            total = total + lower.length() + upper.length();
            total = total + lower.charAt(0) + upper.charAt(0);
        }
        return total;
    }

    static double benchRun() {
        return convert((int) seed);
    }
}
