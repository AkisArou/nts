package nts.rt;

import java.util.Arrays;

/** Dense growable double storage; public double-valued ABI is unchanged. */
public final class NtsArrayD {
    private static final double[] EMPTY = new double[0];
    /**
     * The storage, reachable from generated code.
     *
     * <p>An `array.get` the middle end emitted `checked: false` reads this
     * directly rather than through {@link #get}. Not an encapsulation the
     * wrapper gave up lightly: going through the helper costs 25% of
     * `array-predicates`, because the bounds test against a *field* is what
     * stops C2 treating the walk as a counted loop -- and a loop it will not
     * count is one it will not unroll, vectorise, or hoist this very field
     * out of. Reading it inline, C2 hoists it itself.
     */
    public double[] items;
    int length;

    private NtsArrayD(double[] items, int length) { this.items = items; this.length = length; }


    /**
     * The same construction with an integral length, which needs no round trip.
     *
     * The generated code computes a length in an `i64`, and with only a
     * `double` overload to reach it emitted `d2l; l2d` around the call so that
     * `of` could narrow it back with `(int) n`. `array-predicates` does that
     * per `filter`. Same defect as the subscript's, in the constructor.
     */
    public static NtsArrayD of(long n) {
        int count = n <= 0 ? 0 : (n >= NtsArrays.MAX_ARRAY ? NtsArrays.MAX_ARRAY : (int) n);
        return new NtsArrayD(count == 0 ? EMPTY : new double[count], count);
    }

    public static NtsArrayD of(int n) {
        int count = Math.max(0, n);
        return new NtsArrayD(count == 0 ? EMPTY : new double[count], count);
    }

    public static NtsArrayD of(double n) {
        int count = Math.max(0, (int) n);
        return new NtsArrayD(count == 0 ? EMPTY : new double[count], count);
    }
    public static NtsArrayD empty() { return new NtsArrayD(EMPTY, 0); }
    public static double length(NtsArrayD a) { return a.length; }
    /**
     * Read, refusing an index outside the array rather than reading past it.
     *
     * <p>The subscript is emitted {@code checked: false} where the middle end
     * proved the index in range, and a {@code !} can make that proof a lie --
     * `xs[0]!` on an empty array. The C lane refuses those, seventeen of them
     * in {@code examples/growable}, so this lane has to refuse them too or the
     * two disagree about what the program *did*.
     *
     * <p>{@code a.items[(int) at]} was wrong twice over. Past the capacity it
     * threw an {@code ArrayIndexOutOfBoundsException}, which reads as a crash;
     * and *inside* the capacity but past the length it returned a stale slot
     * from a previous grow, which is a wrong answer with no exception at all.
     * Bounding by {@code a.length} answers both.
     */

    /**
     * The same read with an integral subscript, which needs no round trip.
     *
     * The bare-array path learned this and the growable wrapper did not.
     * `array-predicates` emits `lload; l2d; get(...,D)` per element -- an `i64`
     * loop counter widened to a `double` so a helper can narrow it straight
     * back. That is the defect already fixed for `bounds`, worth 4.56x there,
     * and this path kept paying it because a `double` overload was the only
     * way in.
     *
     * `at < a.length` promotes the `int` for free, and `(int) at` is exact
     * because the comparison has already bounded it.
     */
    public static double get(NtsArrayD a, long at) {
        return at >= 0 && at < a.length ? a.items[(int) at]
            : NtsRuntime.outOfRange((double) at, a.length);
    }

    public static double get(NtsArrayD a, int at) {
        return at >= 0 && at < a.length ? a.items[at]
            : NtsRuntime.outOfRange((double) at, a.length);
    }

    public static double get(NtsArrayD a, double at) {
        // The `(int, int)` overload, not the `(int, double)` one: this
        // subscript is emitted `checked: false`, so the middle end already
        // proved the index integral and only its *range* is in question.
        // The double form re-proves integrality with a `(double)(int)`
        // round trip per element, which cost `growth-grown` 26% -- 1.01x to
        // 1.28x -- for a test whose answer is a precondition here.
        int i = (int) at;
        return i >= 0 && i < a.length ? a.items[i] : NtsRuntime.outOfRange(at, a.length);
    }

    public static void set(NtsArrayD a, double at, double value) {
        int i = (int) at;
        if (i >= a.length) {
            int wanted = NtsArrays.checkedLength((long) i + 1);
            reserve(a, wanted);
            a.length = wanted;
        }
        a.items[i] = value;
    }
    private static void reserve(NtsArrayD a, int wanted) {
        if (wanted > a.items.length) {
            a.items = Arrays.copyOf(a.items, NtsArrays.growCapacity(a.items.length, wanted));
        }
    }
    public static double push(NtsArrayD a, double value) {
        // An append, in `int` and with one read of `items`.
        //
        // It widened `a.length + 1` to a `long` so `checkedLength` could
        // range-check it and narrow it back, then loaded `a.items` twice --
        // once through `reserve` and once to store. `a.length` is a
        // non-negative `int`, so the only value that can overflow is
        // `MAX_ARRAY` itself, and comparing against it directly says the same
        // thing without leaving `int`.
        //
        // `push` is **22.6%** of `array-predicates` and `reserve` a further
        // 11.4%: that row's `filter` builds a fresh array an element at a time,
        // eight times an operation, where the reference allocates once.
        int length = a.length;
        double[] items = a.items;
        if (length == items.length) {
            // Inside the grow, not before it. A `length` below the capacity is
            // below `MAX_ARRAY` already, because the capacity is -- so the
            // guard was answering on the appending path a question only the
            // growing path can ask. Two instructions an append is not the
            // point; the bytes are, because `push` is inlined into a caller
            // with a budget and record 0109 is about what eighteen of them
            // decide.
            if (length >= NtsArrays.MAX_ARRAY) {
                throw new OutOfMemoryError("array capacity exhausted");
            }
            items = Arrays.copyOf(items, NtsArrays.growCapacity(items.length, length + 1));
            a.items = items;
        }
        items[length] = value;
        a.length = length + 1;
        return length + 1;
    }
    /** The nonempty precondition is supplied by lowering; use popValue otherwise. */
    public static double pop(NtsArrayD a) {
        int n = a.length - 1;
        double last = a.items[n];
        a.items[n] = 0.0;
        a.length = n;
        return last;
    }
    public static double shift(NtsArrayD a) {
        double first = a.items[0];
        int n = a.length - 1;
        System.arraycopy(a.items, 1, a.items, 0, n);
        a.items[n] = 0.0;
        a.length = n;
        return first;
    }
    public static double unshift(NtsArrayD a, double value) {
        int n = NtsArrays.checkedLength((long) a.length + 1);
        reserve(a, n);
        System.arraycopy(a.items, 0, a.items, 1, a.length);
        a.items[0] = value;
        a.length = n;
        return n;
    }
    public static double at(NtsArrayD a, double index) {
        int i = NtsArrays.offset(index, a.length);
        return i < 0 ? Double.NaN : a.items[i];
    }
    public static double indexOf(NtsArrayD a, double value) {
        double[] items = a.items;
        for (int i = 0, n = a.length; i < n; i++) {
            if (items[i] == value) { return i; }
        }
        return -1.0;
    }
    public static double lastIndexOf(NtsArrayD a, double value) {
        double[] items = a.items;
        for (int i = a.length - 1; i >= 0; i--) {
            if (items[i] == value) { return i; }
        }
        return -1.0;
    }
    public static boolean includes(NtsArrayD a, double value) {
        if (value != value) {
            double[] items = a.items;
            for (int i = 0, n = a.length; i < n; i++) {
                if (items[i] != items[i]) { return true; }
            }
            return false;
        }
        return indexOf(a, value) >= 0.0;
    }
    public static NtsArrayD fill(NtsArrayD a, double value) {
        Arrays.fill(a.items, 0, a.length, value);
        return a;
    }
    public static NtsArrayD reverse(NtsArrayD a) {
        double[] items = a.items;
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            double swap = items[i]; items[i] = items[j]; items[j] = swap;
        }
        return a;
    }
    public static NtsArrayD slice(NtsArrayD a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length);
        int end = Math.max(start, NtsArrays.clamp(to, a.length));
        return new NtsArrayD(start == end ? EMPTY : Arrays.copyOfRange(a.items, start, end), end - start);
    }
    public static NtsArrayD concat(NtsArrayD a, NtsArrayD b) {
        int n = NtsArrays.checkedLength((long) a.length + b.length);
        double[] joined = n == 0 ? EMPTY : new double[n];
        System.arraycopy(a.items, 0, joined, 0, a.length);
        System.arraycopy(b.items, 0, joined, a.length, b.length);
        return new NtsArrayD(joined, n);
    }
    public static NtsArrayD extend(NtsArrayD a, NtsArrayD b) {
        int old = a.length;
        int extra = b.length;
        int n = NtsArrays.checkedLength((long) old + extra);
        reserve(a, n);
        // arraycopy supports overlap; a.extend(a) is valid.
        System.arraycopy(b.items, 0, a.items, old, extra);
        a.length = n;
        return a;
    }
    public static void keepFirst(NtsArrayD a, double count) {
        int keep = Math.max(0, Math.min((int) count, a.length));
        Arrays.fill(a.items, keep, a.length, 0.0);
        a.length = keep;
    }
    public static NtsArrayD splice(NtsArrayD a, double at, double count) {
        int start = NtsArrays.clamp(at, a.length);
        int removed = Math.max(0, Math.min((int) count, a.length - start));
        NtsArrayD taken = new NtsArrayD(removed == 0 ? EMPTY :
            Arrays.copyOfRange(a.items, start, start + removed), removed);
        if (removed != 0) {
            int old = a.length;
            System.arraycopy(a.items, start + removed, a.items, start, old - start - removed);
            a.length = old - removed;
            Arrays.fill(a.items, a.length, old, 0.0);
        }
        return taken;
    }
    public static String joinStr(NtsArrayD a, String separator) {
        int n = a.length;
        if (n == 0) { return ""; }
        StringBuilder out = new StringBuilder(NtsArrays.joinCapacity(n, separator, 8));
        for (int i = 0; i < n; i++) {
            if (i != 0) { out.append(separator); }
            NtsRuntime.appendNumber(out, a.items[i]);
        }
        return out.toString();
    }
    public static NtsValue popValue(NtsArrayD a) {
        return a.length == 0 ? NtsValue.ABSENT_NUMBER : NtsValue.ofNumber(pop(a));
    }
    public static NtsValue shiftValue(NtsArrayD a) {
        return a.length == 0 ? NtsValue.ABSENT_NUMBER : NtsValue.ofNumber(shift(a));
    }
    public static NtsValue atValue(NtsArrayD a, double index) {
        int i = NtsArrays.offset(index, a.length);
        return i < 0 ? NtsValue.ABSENT_NUMBER : NtsValue.ofNumber(a.items[i]);
    }
}
