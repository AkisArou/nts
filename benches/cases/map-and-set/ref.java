// What a Java programmer writes for a keyed table and a membership set:
// `HashMap` and `HashSet`.
//
// **Both box every key**, because the JDK has no primitive-keyed map. That is
// not a handicap invented for this reference, it is the standard library:
// Trove and fastutil exist and are not the JDK, and reaching for a third-party
// primitive map would be answering a question about dependency choice.
//
// **`Double`, not `Integer`, and that is a correction.** This read
// `Map<Integer, Integer>` and argued that a person reaching for a map of
// numbers gets `Integer` keys. The TypeScript is `Map<number, number>`, this
// lane keys and values it in `f64`, and the rule the suite keeps is that a
// reference may not hold a field narrower than the f64 a TypeScript `number`
// is. `Integer` is narrower twice over: `Integer.hashCode` is `return value`
// where a double's is a bit fold, and `Integer.valueOf` caches -128..127 where
// `Double.valueOf` caches nothing.
//
// It cost the row 1.89x. Priced by writing the workload by hand on both
// structures -- `HashMap<Double, Double>` against `nts.rt.NtsMap`, the same
// 253 rounds, the same probes -- **our map is 76,784 cycles an operation
// against the JDK's 128,540**, which is 0.60x. The four hypotheses that died
// looking for what made this row slow (records 0156 and 0163) were looking for
// something that was not there: the map is faster and the reference was
// measuring a narrower one.
//
// `runtime/jvm` implements `NtsMap` by hand rather than wrapping
// `LinkedHashMap`, for two reasons written down in the plan: the lowering emits
// an index-based `nts_map_next(map, from)` contract that `LinkedHashMap` cannot
// express, and JS keys by SameValueZero where `Double.equals` disagrees about
// `-0`. This case never iterates and never uses `-0`, so neither difference can
// appear here -- the row is about probe cost and nothing else, and the two
// reasons are noted so nobody concludes from a good number that the wrapper
// would have done.
//
// `getOrDefault` is `?? 0` exactly: the TypeScript's `??` fires on a missing
// key, and every stored value here is a number, so a present-but-nullish value
// -- the one case where the two would part -- cannot occur.
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

final class Ref extends Bench.Work {
    // `volatile` so the trip count and the keys are not compile-time constants.
    private static volatile double seed = 3;

    static int table(int seed) {
        Map<Double, Double> seen = new HashMap<>();
        Set<Double> marks = new HashSet<>();
        int rounds = 253 + seed;

        for (int i = 0; i < rounds; i++) {
            seen.put((double) (i * 7), (double) i);
            marks.add((double) (i * 3));
        }
        int total = 0;
        for (int i = 0; i < rounds; i++) {
            total = total + (int) (double) seen.getOrDefault((double) (i * 7), 0.0);
            if (marks.contains((double) (i * 3))) {
                total = total + 1;
            }
            // A miss on both, which is the probe that walks until it finds a
            // hole.
            if (seen.containsKey((double) (i * 7 + 1))) {
                total = total + 100;
            }
        }
        // Overwrite every key: the slot is there, so this must not grow
        // anything.
        for (int i = 0; i < rounds; i++) {
            seen.put((double) (i * 7), (double) total);
        }
        return total + seen.size() + marks.size();
    }

    @Override public double run() {
        return table((int) seed);
    }
}
