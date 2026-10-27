// What a careful Java programmer writes for case conversion:
// `toLowerCase(Locale.ROOT)` (see `case-convert`'s reference for why the
// locale argument is not optional).
//
// Java applies Final_Sigma and JavaScript does too; no word in this text ends in sigma, so the rule never fires and the two agree. The unconditional Greek mapping, tonos included, is otherwise the same function.
//
// The inputs are built once and indexed, as the TypeScript does, so the
// conversion is measured and the concatenation is not.
import java.util.Locale;

final class Ref extends Bench.Work {
    // `volatile` so the strings are not compile-time constants.
    private static volatile double seed = 3;

    static int convert(int seed) {
        String base = "Σοφία Σχολείο αστερι μέση Θάλασσα κήπος φωτιά " + Integer.toString(seed);
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
