// What a Java programmer writes for a word count: a `HashMap` keyed by
// `String`.
//
// **`Double` values**, because the TypeScript is `Record<string, number>` and
// this lane holds each value in an `f64`; the rule the suite keeps is that a
// reference may not hold a field narrower than the f64 a TypeScript `number`
// is. The keys are the strings the program built once, as the TypeScript's
// vocabulary is.
//
// `get` and a null test stand for both of the TypeScript's asking reads: `||
// 0` and `?? 0` part only on a stored 0 or NaN, and every stored count here is
// at least 1.
import java.util.HashMap;
import java.util.Map;

final class Ref extends Bench.Work {
    // `volatile` so the trip count and the keys are not compile-time constants.
    private static volatile double seed = 3;

    private static final String[] VOCABULARY = new String[96];

    static {
        for (int i = 0; i < 96; i++) {
            VOCABULARY[i] = "word" + i;
        }
    }

    static int wordCounts(int seed) {
        Map<String, Double> counts = new HashMap<>();
        int s = seed & 1023;
        int rounds = 509 + s;
        for (int i = 0; i < rounds; i++) {
            String w = VOCABULARY[(i * 13 + s) & 63];
            Double found = counts.get(w);
            counts.put(w, (found == null ? 0.0 : found) + 1.0);
        }
        int total = 0;
        for (int i = 0; i < rounds; i++) {
            Double found = counts.get(VOCABULARY[(i * 7 + s) % 96]);
            total = total + (found == null ? 0 : (int) (double) found);
        }
        for (int i = 0; i < 64; i++) {
            total = total + (int) (counts.get(VOCABULARY[i]) * (i + 1));
        }
        return total;
    }

    @Override public double run() {
        return wordCounts((int) seed);
    }
}
