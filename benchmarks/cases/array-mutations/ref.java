// What a Java programmer writes for `push`, `shift`, `unshift`, `splice`,
// spread and `concat` over numbers, once they have looked at a profile: a
// growable `double[]`.
//
// **This reference used to be an `ArrayList<Integer>`**, and the comment here
// used to argue that a hand-rolled primitive list "is not what anybody writes
// when the operations are spelled `shift` and `splice`" and would be "measuring
// my patience rather than Java's". That was wrong twice.
//
// It was wrong about the rule. A reference must decline anything that puts a
// cost in one lane only, and `ArrayList<Integer>` boxes every element the
// compiled program keeps unboxed. Unlike `generic-classes` -- where the boxes
// never leave the loop and C2 removes them, which is why that row sits at
// parity against a boxing reference and the boxing is not a lane-only cost --
// these boxes go *into the list* and escape analysis cannot touch them.
//
// **And the boxing was not what it cost.** Replacing it made the reference
// *slower*, 2.03 us to 2.48 us, and the row went 1.06x to 0.68x -- the opposite
// of the direction the rule's usual justification predicts. An `Object[]` of
// small `Integer`s moves four bytes an element under compressed oops where a
// `double[]` moves eight, and `ArrayList`'s shift and splice are
// `System.arraycopy` over that. So this row is one we win by *less* than the
// old number said rather than more, and the reason to make the change is that
// the reference has to hold what the program holds, not that holding it
// otherwise was flattering us.
//
// It was also wrong about what a person writes. `it.unimi.dsi.fastutil
// .doubles.DoubleArrayList` exists, is what a Java programmer reaches for when
// a profile shows boxing, and has exactly these operations. This suite takes no
// dependencies, so the fifty lines below stand in for it -- which is a
// statement about our build, not about what anybody would write.
//
// `splice(1, 2)` is still the interesting translation: it both returns the
// removed elements and mutates in place. `Arrays.copyOfRange` then
// `System.arraycopy` over the hole is the primitive-array spelling of what
// `subList`/`clear` did.
//
// `remove(0)` is `shift` and is O(n) on a packed array, exactly as a shift on a
// JavaScript array is. The TypeScript's `?? 0` guards an empty array, which
// cannot happen here because a `push` precedes every `shift`; it is written out
// anyway so the two programs are the same on inputs this case does not reach.
import java.util.Arrays;

final class Ref extends Bench.Work {
    /** The `DoubleArrayList` this suite cannot depend on. */
    static final class DoubleList {
        double[] items;
        int size;

        DoubleList(int capacity) { items = new double[Math.max(4, capacity)]; }

        static DoubleList of(DoubleList source) {
            DoubleList copy = new DoubleList(source.size);
            System.arraycopy(source.items, 0, copy.items, 0, source.size);
            copy.size = source.size;
            return copy;
        }

        void reserve(int wanted) {
            if (wanted > items.length) {
                items = Arrays.copyOf(items, Math.max(wanted, items.length * 2));
            }
        }

        void add(double value) {
            reserve(size + 1);
            items[size++] = value;
        }

        void addFirst(double value) {
            reserve(size + 1);
            System.arraycopy(items, 0, items, 1, size);
            items[0] = value;
            size++;
        }

        double removeFirst() {
            double first = items[0];
            System.arraycopy(items, 1, items, 0, --size);
            return first;
        }

        DoubleList cut(int from, int count) {
            DoubleList taken = new DoubleList(count);
            System.arraycopy(items, from, taken.items, 0, count);
            taken.size = count;
            System.arraycopy(items, from + count, items, from, size - from - count);
            size -= count;
            return taken;
        }

        void addAll(DoubleList other) {
            reserve(size + other.size);
            System.arraycopy(other.items, 0, items, size, other.size);
            size += other.size;
        }
    }

    // `volatile` so the length and contents are not compile-time constants.
    private static volatile double seed = 3;

    static int mutations(int seed) {
        int n = 128 + seed;
        DoubleList xs = new DoubleList(n);
        for (int i = 0; i < n; i++) {
            xs.add(i * 3 + seed);
        }

        int total = 0;
        for (int round = 0; round < 8; round++) {
            xs.add(round + seed);
            total = total + (int) (xs.size == 0 ? 0 : xs.removeFirst());

            xs.addFirst(round * 2 + seed);
            DoubleList gone = xs.cut(1, 2);
            total = total + gone.size + (int) gone.items[0];

            DoubleList copy = DoubleList.of(xs);
            total = total + copy.size + (int) copy.items[0];

            DoubleList both = DoubleList.of(copy);
            both.addAll(gone);
            total = total + both.size;
        }
        return total;
    }

    @Override public double run() {
        return mutations((int) seed);
    }
}
