// What a Java programmer writes for `push`, `shift`, `unshift`, `splice`,
// spread and `concat`: `ArrayList`, and `subList` for the one that has no name.
//
// **This reference boxes and the compiled program does not**, which makes it
// the friendliest reference in the suite and it is still the right one. The JDK
// has no primitive-element list, `ArrayDeque` gives cheap ends but no indexed
// splice, and a hand-rolled `int[]` with a head offset is not what anybody
// writes when the operations are spelled `shift` and `splice`. The alternative
// -- writing the ring buffer by hand -- would be measuring my patience rather
// than Java's.
//
// So read a loss on this row as real and a win as smaller than it looks.
//
// `splice(1, 2)` is the interesting translation: it both returns the removed
// elements and mutates in place, and Java splits those. `new ArrayList<>(sub)`
// then `sub.clear()` is the idiom, and `subList` is a *view*, so the clear is
// what removes them from the backing list -- copying first is not an
// optimisation, it is required for the result to survive.
//
// `remove(0)` is `shift` and is O(n) on an `ArrayList`, exactly as a shift on a
// packed array is. The TypeScript's `?? 0` guards an empty array, which cannot
// happen here because a `push` precedes every `shift`; it is written out anyway
// so the two programs are the same on inputs this case does not reach.
import java.util.ArrayList;
import java.util.List;

final class Ref {
    // `volatile` so the length and contents are not compile-time constants.
    private static volatile double seed = 3;

    static int mutations(int seed) {
        int n = 128 + seed;
        List<Integer> xs = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            xs.add(i * 3 + seed);
        }

        int total = 0;
        for (int round = 0; round < 8; round++) {
            xs.add(round + seed);
            total = total + (xs.isEmpty() ? 0 : xs.remove(0));

            xs.add(0, round * 2 + seed);
            List<Integer> gone = new ArrayList<>(xs.subList(1, 3));
            xs.subList(1, 3).clear();
            total = total + gone.size() + gone.get(0);

            List<Integer> copy = new ArrayList<>(xs);
            total = total + copy.size() + copy.get(0);

            List<Integer> both = new ArrayList<>(copy);
            both.addAll(gone);
            total = total + both.size();
        }
        return total;
    }

    static double benchRun() {
        return mutations((int) seed);
    }
}
