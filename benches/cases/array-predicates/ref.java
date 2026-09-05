// What a Java programmer writes for `some`, `every`, `findIndex` and `filter`
// over numbers: `IntStream`, one lambda apiece.
//
// Three of the four map straight across -- `anyMatch`, `allMatch`, and a
// `filter` that materialises with `toArray`, which is what `Array.prototype
// .filter` returns. `findIndex` has no analogue at all: Java's `findFirst`
// answers with the *element*, not its position, so the index has to be built by
// streaming the range and filtering on a lookup. That is what a person writes,
// and it is the one place this reference is wordier than the TypeScript for a
// reason that is Java's rather than ours.
//
// `anyMatch` and `allMatch` short-circuit exactly as `some` and `every` do, so
// the asymmetry the TypeScript points at survives the translation: the `some`
// finds its target early and the `every` is never false, so it walks the whole
// array. Both lanes do the same amount of work for the same reason.
//
// `int[]` rather than a `List<Integer>`: the elements are `i * 7 + seed` with
// `seed` an int32, a person would not box them, and `IntStream` exists so they
// do not have to.
import java.util.Arrays;
import java.util.stream.IntStream;

final class Ref extends Bench.Work {
    // `volatile` so the length and the contents are not compile-time constants.
    private static volatile double seed = 3;

    static int predicates(int seed) {
        final int n = 256 + seed;
        final int[] xs = new int[n];
        for (int i = 0; i < n; i++) {
            xs[i] = i * 7 + seed;
        }

        int total = 0;
        for (int round = 0; round < 8; round++) {
            final int target = round * 13 + seed;
            if (Arrays.stream(xs).anyMatch(v -> v == target)) {
                total = total + 1;
            }
            // Never false, so this one walks all of it.
            if (Arrays.stream(xs).allMatch(v -> v >= 0)) {
                total = total + 2;
            }
            total = total + IntStream.range(0, n).filter(i -> xs[i] > target).findFirst().orElse(-1);
            int[] kept = Arrays.stream(xs).filter(v -> v > target).toArray();
            total = total + kept.length;
        }
        return total;
    }

    @Override public double run() {
        return predicates((int) seed);
    }
}
