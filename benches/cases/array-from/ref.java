// What a Java programmer writes for `Array.from`: `Arrays.copyOf` for an array
// and `toArray` for a set.
//
// Two different copies, which is why the case names both. `Arrays.copyOf` is an
// intrinsic that becomes a bulk memory move; `Set::toArray` has to walk the
// table and cannot, so it is a scan with a store per element. The TypeScript's
// two `Array.from` calls have exactly that split under them, and the row is
// whether ours splits the same way.
//
// The set's *length* is read rather than an element, for the reason the
// TypeScript gives: a `Set`'s iteration order is insertion order in JavaScript
// and hash order in Java, so indexing one would compare two orders rather than
// two copies. The walk runs to the end either way, so the work is the same and
// only the comparison is made safe.
//
// `Set<Integer>` boxes, as `map-and-set/ref.java` does and for the same reason:
// the JDK has no primitive set.
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class Ref {
    // `volatile` so the contents are not compile-time constants.
    private static volatile double seed = 5;

    static double work(int seed) {
        int[] xs = new int[256];
        for (int i = 0; i < 256; i++) {
            xs[i] = i + seed;
        }
        Set<Integer> marks = new HashSet<>();
        for (int i = 0; i < 256; i++) {
            marks.add(i * 3 + seed);
        }

        double total = 0;
        for (int round = 0; round < 2000; round++) {
            int[] copied = Arrays.copyOf(xs, xs.length);
            total = total + copied[round % 256];
            Object[] listed = marks.toArray();
            total = total + listed.length;
        }
        return total;
    }

    static double benchRun() {
        return work((int) seed);
    }
}
