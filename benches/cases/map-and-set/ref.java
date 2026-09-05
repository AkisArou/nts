// What a Java programmer writes for a keyed table and a membership set:
// `HashMap` and `HashSet`.
//
// **Both box every key**, because the JDK has no primitive-keyed map. That is
// not a handicap invented for this reference, it is the standard library: a
// person reaching for a map of numbers gets `Integer` keys and an allocation
// per distinct key unless the value falls in `Integer.valueOf`'s -128..127
// cache, and these keys run to 7 * 255. Trove and fastutil exist and are not
// the JDK, and reaching for a third-party primitive map would be answering a
// question about dependency choice.
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
        Map<Integer, Integer> seen = new HashMap<>();
        Set<Integer> marks = new HashSet<>();
        int rounds = 253 + seed;

        for (int i = 0; i < rounds; i++) {
            seen.put(i * 7, i);
            marks.add(i * 3);
        }
        int total = 0;
        for (int i = 0; i < rounds; i++) {
            total = total + seen.getOrDefault(i * 7, 0);
            if (marks.contains(i * 3)) {
                total = total + 1;
            }
            // A miss on both, which is the probe that walks until it finds a
            // hole.
            if (seen.containsKey(i * 7 + 1)) {
                total = total + 100;
            }
        }
        // Overwrite every key: the slot is there, so this must not grow
        // anything.
        for (int i = 0; i < rounds; i++) {
            seen.put(i * 7, total);
        }
        return total + seen.size() + marks.size();
    }

    @Override public double run() {
        return table((int) seed);
    }
}
