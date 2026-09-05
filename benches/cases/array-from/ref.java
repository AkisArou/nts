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
//
// `int[]` rather than `double[]`, which is the deliberate harder reference
// `arrays` and `array-predicates` also write, and it is worth naming here
// because on this row it is most of the number. The TypeScript is `number[]`,
// so the lane prepares `managed<[f64]>` and copies eight bytes an element where
// this copies four. Measured rather than assumed: **8,280,888 bytes/op against
// the reference's 4,176,848**, a factor of 1.98 on a row whose whole subject is
// two copies.
//
// So the gap is element width and the row should show it. `hir::elements`
// proving these are int32 is what closes it, and `dispatch` -- which already
// prepares as `[i32]` -- is what that looks like when it has happened.
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class Ref extends Bench.Work {
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

    @Override public double run() {
        return work((int) seed);
    }
}
