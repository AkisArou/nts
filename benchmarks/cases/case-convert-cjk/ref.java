// What a careful Java programmer writes for case conversion:
// `toLowerCase(Locale.ROOT)` (see `case-convert`'s reference for why the
// locale argument is not optional).
//
// Java's String length counts UTF-16 units as JavaScript's does, and its case conversion of caseless text is the same scan for nothing to change.
//
// The inputs are built once and indexed, as the TypeScript does, so the
// conversion is measured and the concatenation is not.
import java.util.Locale;

final class Ref extends Bench.Work {
    // `volatile` so the strings are not compile-time constants.
    private static volatile double seed = 3;

    static int convert(int seed) {
        String base = "A中文字符 日本語 テスト 漢字 かな カナ 汉语 " + Integer.toString(seed);
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

    @Override public double run() {
        return convert((int) seed);
    }
}
