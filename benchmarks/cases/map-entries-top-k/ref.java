// What a Java programmer writes for the top k of a word count: a `HashMap`'s
// entry set copied into an `ArrayList`, sorted with a comparator, and the
// first k read.
//
// **The whole list sorted, not a bounded heap.** The TypeScript sorts every
// entry and then slices, and the row compares the idiom as written. The
// order is total (count, then word), so `List.sort`'s stability decides
// nothing.
//
// **`Double` values**, because the TypeScript is `Map<string, number>` and
// this lane holds each value in an f64; a reference may not hold a field
// narrower than the f64 a TypeScript `number` is. The list holds the map's
// own entries rather than fresh pairs, which is what `new
// ArrayList<>(map.entrySet())` gives a Java programmer, and is a discount the
// TypeScript does not get: its pairs are new.
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class Ref extends Bench.Work {
    // `volatile` so the trip count and the keys are not compile-time constants.
    private static volatile double seed = 3;

    private static final String[] VOCABULARY = new String[256];

    static {
        for (int i = 0; i < 256; i++) {
            VOCABULARY[i] = "word" + i;
        }
    }

    static int topWords(int seed) {
        Map<String, Double> counts = new HashMap<>();
        int s = seed & 1023;
        int rounds = 1021 + s;
        int state = 1 + s;
        for (int i = 0; i < rounds; i++) {
            state = (state * 75 + 74) % 65537;
            String w = VOCABULARY[((state & 255) * ((state >> 8) & 255)) >> 8];
            Double found = counts.get(w);
            counts.put(w, (found == null ? 0.0 : found) + 1.0);
        }
        List<Map.Entry<String, Double>> entries = new ArrayList<>(counts.entrySet());
        entries.sort((a, b) -> {
            int byCount = Double.compare(b.getValue(), a.getValue());
            return byCount != 0 ? byCount : a.getKey().compareTo(b.getKey());
        });
        int k = Math.min(16, entries.size());
        int total = 0;
        for (int i = 0; i < k; i++) {
            Map.Entry<String, Double> entry = entries.get(i);
            total = total + (int) (entry.getValue() * (i + 1)) + entry.getKey().length() * 1000;
        }
        return total;
    }

    @Override public double run() {
        return topWords((int) seed);
    }
}
