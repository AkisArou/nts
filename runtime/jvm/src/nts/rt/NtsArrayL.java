package nts.rt;

import java.util.Arrays;

/** Dense growable Object storage; public double-valued ABI is unchanged. */
public final class NtsArrayL {
    private static final Object[] EMPTY = new Object[0];
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
    public Object[] items;
    int length;

    private NtsArrayL(Object[] items, int length) { this.items = items; this.length = length; }


    /**
     * The same construction with an integral length, which needs no round trip.
     *
     * The generated code computes a length in an `i64`, and with only a
     * `double` overload to reach it emitted `d2l; l2d` around the call so that
     * `of` could narrow it back with `(int) n`. `array-predicates` does that
     * per `filter`. Same defect as the subscript's, in the constructor.
     */
    public static NtsArrayL of(long n) {
        int count = n <= 0 ? 0 : (n >= NtsArrays.MAX_ARRAY ? NtsArrays.MAX_ARRAY : (int) n);
        return new NtsArrayL(count == 0 ? EMPTY : new Object[count], count);
    }

    public static NtsArrayL of(int n) {
        int count = Math.max(0, n);
        return new NtsArrayL(count == 0 ? EMPTY : new Object[count], count);
    }

    public static NtsArrayL of(double n) {
        int count = Math.max(0, (int) n);
        return new NtsArrayL(count == 0 ? EMPTY : new Object[count], count);
    }
    public static NtsArrayL empty() { return new NtsArrayL(EMPTY, 0); }
    public static double length(NtsArrayL a) { return a.length; }
    /**
     * The same length where the middle end asked for an integer.
     *
     * <p>`array.len` is an `i32` upstream now, and the only way to it was a
     * helper returning `double`, so a length went `getfield; i2d` and the
     * caller put it back with `d2i`. The same round trip the subscript and
     * the constructor were given overloads to avoid, in the third place it
     * occurs.
     */
    public static int count(NtsArrayL a) { return a.length; }
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

    public static Object get(NtsArrayL a, int at) {
        if (at >= 0 && at < a.length) { return a.items[at]; }
        NtsRuntime.outOfRange((double) at, a.length);
        return null;
    }

    public static Object get(NtsArrayL a, double at) {
        // The `(int, int)` overload, not the `(int, double)` one: this
        // subscript is emitted `checked: false`, so the middle end already
        // proved the index integral and only its *range* is in question.
        // The double form re-proves integrality with a `(double)(int)`
        // round trip per element, which cost `growth-grown` 26% -- 1.01x to
        // 1.28x -- for a test whose answer is a precondition here.
        int i = (int) at;
        if (i >= 0 && i < a.length) { return a.items[i]; }
        NtsRuntime.outOfRange(at, a.length);
        return null;
    }

    public static void set(NtsArrayL a, double at, Object value) {
        int i = (int) at;
        if (i >= a.length) {
            int wanted = NtsArrays.checkedLength((long) i + 1);
            reserve(a, wanted);
            a.length = wanted;
        }
        a.items[i] = value;
    }
    private static void reserve(NtsArrayL a, int wanted) {
        if (wanted > a.items.length) {
            a.items = Arrays.copyOf(a.items, NtsArrays.growCapacity(a.items.length, wanted));
        }
    }
    public static double push(NtsArrayL a, Object value) {
        // The append `NtsArrayD` was given and this one was not: in `int`, with
        // one read of `items`. It widened `a.length + 1` to a `long` so
        // `checkedLength` could range-check it and narrow it back, then reached
        // `a.items` twice more -- once through `reserve` and once to store.
        // `a.length` is a non-negative `int` over an `Object[]`, so the only value that
        // can overflow is `MAX_ARRAY` itself, and only a grow can reach it.
        int length = a.length;
        Object[] items = a.items;
        if (length == items.length) {
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

    /**
     * `arr.length = n`, in place.
     *
     * <p>JavaScript uses a length assignment to truncate, and the corpus does
     * it 62 times -- a loop writes survivors to a cursor, then cuts the tail.
     * The obvious alternative is {@code splice(a, n, len - n)}, which hands
     * back the removed run as a **new array**: an allocation JavaScript does
     * not make, once per compaction, in code whose whole purpose is to avoid
     * allocating.
     *
     * <p><b>Growing is refused rather than answered.</b> {@code arr.length = n}
     * with {@code n} past the end produces holes, and a hole has no
     * representation in this compiler at all -- so refusing is not the safer of
     * two answers, it is the only available one until there is a hole. All 62
     * corpus sites shrink, so the refusal costs nothing today and is here so
     * the feature is not half-answered silently.
     *
     * <p>A non-integral or negative length is a {@code RangeError} in
     * JavaScript and is refused for the same reason.
     */
    public static void setLength(NtsArrayL a, double n) {
        // **The bound is 2^32-1, not Integer.MAX_VALUE, and the difference is a
        // real input.** JavaScript's rule is that `ToUint32(n)` must equal `n`,
        // so `xs.length = 4294967295` is a *valid* length node accepts -- it
        // grows and makes holes. Casting straight to `int` saturates at
        // 2147483647, which then fails the `want != n` test and refuses it as a
        // RangeError: the right outcome reached by the wrong rule, and reported
        // as the language's objection when it is ours. Checked against node,
        // which throws for 1.5, -1, NaN and 2^32, and accepts 2^32-1.
        if (!(n >= 0 && n <= 4294967295.0) || n != Math.floor(n)) {
            // **JavaScript's rule, not ours.** `xs.length = 1.5` and
            // `xs.length = -1` throw `RangeError` in node, so refusing here is
            // spec compliance and the message says whose rule it is. The growth
            // refusal below is the opposite: node accepts it happily and
            // produces holes, and we decline because a hole has no
            // representation in this backend at all. Conflating the two would
            // make a deliberate boundary read as conformance.
            throw new NtsRefusal(
                "RangeError: invalid array length -- `length` must be a non-negative integer, got "
                + n);
        }
        long want64 = (long) n;
        if (want64 > a.length) {
            throw new NtsRefusal(
                "growing an array by assigning `length` would create holes, which this compiler "
                + "has no representation for -- length " + a.length + " to " + want64);
        }
        int want = (int) want64;
        if (want == a.length) {
            return;
        }
        // Null the dropped slots. Under `NoGc` the platform collector owns
        // these objects, so a stale reference in the backing array keeps one
        // alive for as long as the array does -- which is the JVM's form of
        // the release the C lane does, and the same thing `pop` and `shift`
        // already do for the single element they drop.
        java.util.Arrays.fill(a.items, want, a.length, null);
        a.length = want;
    }

    public static Object pop(NtsArrayL a) {
        int n = a.length - 1;
        Object last = a.items[n];
        a.items[n] = null;
        a.length = n;
        return last;
    }
    public static Object shift(NtsArrayL a) {
        Object first = a.items[0];
        int n = a.length - 1;
        System.arraycopy(a.items, 1, a.items, 0, n);
        a.items[n] = null;
        a.length = n;
        return first;
    }
    public static double unshift(NtsArrayL a, Object value) {
        int n = NtsArrays.checkedLength((long) a.length + 1);
        reserve(a, n);
        System.arraycopy(a.items, 0, a.items, 1, a.length);
        a.items[0] = value;
        a.length = n;
        return n;
    }
    public static Object at(NtsArrayL a, double index) {
        int i = NtsArrays.offset(index, a.length);
        return i < 0 ? null : a.items[i];
    }
    public static double indexOf(NtsArrayL a, Object value) {
        Object[] items = a.items;
        for (int i = 0, n = a.length; i < n; i++) {
            if (items[i] == value) { return i; }
        }
        return -1.0;
    }
    public static double lastIndexOf(NtsArrayL a, Object value) {
        Object[] items = a.items;
        for (int i = a.length - 1; i >= 0; i--) {
            if (items[i] == value) { return i; }
        }
        return -1.0;
    }
    public static boolean includes(NtsArrayL a, Object value) {
        return indexOf(a, value) >= 0.0;
    }
    public static NtsArrayL fill(NtsArrayL a, Object value) {
        Arrays.fill(a.items, 0, a.length, value);
        return a;
    }
    public static NtsArrayL reverse(NtsArrayL a) {
        Object[] items = a.items;
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            Object swap = items[i]; items[i] = items[j]; items[j] = swap;
        }
        return a;
    }
    public static NtsArrayL slice(NtsArrayL a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length);
        int end = Math.max(start, NtsArrays.clamp(to, a.length));
        return new NtsArrayL(start == end ? EMPTY : Arrays.copyOfRange(a.items, start, end), end - start);
    }
    public static NtsArrayL concat(NtsArrayL a, NtsArrayL b) {
        int n = NtsArrays.checkedLength((long) a.length + b.length);
        Object[] joined = n == 0 ? EMPTY : new Object[n];
        System.arraycopy(a.items, 0, joined, 0, a.length);
        System.arraycopy(b.items, 0, joined, a.length, b.length);
        return new NtsArrayL(joined, n);
    }
    public static NtsArrayL extend(NtsArrayL a, NtsArrayL b) {
        int old = a.length;
        int extra = b.length;
        int n = NtsArrays.checkedLength((long) old + extra);
        reserve(a, n);
        // arraycopy supports overlap; a.extend(a) is valid.
        System.arraycopy(b.items, 0, a.items, old, extra);
        a.length = n;
        return a;
    }
    public static void keepFirst(NtsArrayL a, double count) {
        int keep = Math.max(0, Math.min((int) count, a.length));
        Arrays.fill(a.items, keep, a.length, null);
        a.length = keep;
    }
    public static NtsArrayL splice(NtsArrayL a, double at, double count) {
        int start = NtsArrays.clamp(at, a.length);
        int removed = Math.max(0, Math.min((int) count, a.length - start));
        NtsArrayL taken = new NtsArrayL(removed == 0 ? EMPTY :
            Arrays.copyOfRange(a.items, start, start + removed), removed);
        if (removed != 0) {
            int old = a.length;
            System.arraycopy(a.items, start + removed, a.items, start, old - start - removed);
            a.length = old - removed;
            Arrays.fill(a.items, a.length, old, null);
        }
        return taken;
    }
    public static String joinStr(NtsArrayL a, String separator) {
        int n = a.length;
        if (n == 0) { return ""; }
        StringBuilder out = new StringBuilder(NtsArrays.joinCapacity(n, separator, 8));
        for (int i = 0; i < n; i++) {
            if (i != 0) { out.append(separator); }
            // toString may re-enter the runtime and mutate this array.
            NtsRuntime.appendJoinElement(out, i < a.length ? a.items[i] : null);
        }
        return out.toString();
    }
    public static NtsValue popValue(NtsArrayL a) {
        return a.length == 0 ? NtsValue.UNDEFINED_VALUE : wrap(pop(a));
    }
    public static NtsValue shiftValue(NtsArrayL a) {
        return a.length == 0 ? NtsValue.UNDEFINED_VALUE : wrap(shift(a));
    }
    public static NtsValue atValue(NtsArrayL a, double index) {
        int i = NtsArrays.offset(index, a.length);
        return i < 0 ? NtsValue.UNDEFINED_VALUE : wrap(a.items[i]);
    }
    private static NtsValue wrap(Object element) {
        return element instanceof NtsValue ? (NtsValue) element : NtsValue.ofObject(element);
    }
    public static double indexOfStr(NtsArrayL a, Object value) {
        for (int i = 0, n = a.length; i < n; i++) {
            if (java.util.Objects.equals(a.items[i], value)) { return i; }
        }
        return -1.0;
    }
    public static double lastIndexOfStr(NtsArrayL a, Object value) {
        for (int i = a.length - 1; i >= 0; i--) {
            if (java.util.Objects.equals(a.items[i], value)) { return i; }
        }
        return -1.0;
    }
    public static boolean includesStr(NtsArrayL a, Object value) {
        return indexOfStr(a, value) >= 0.0;
    }

    /**
     * A Java array, used directly as this array's storage.
     *
     * <p><strong>Zero copy, because a {@code String[]} is an {@code Object[]}.</strong>
     * Java's array covariance is usually a hazard and is exactly the right
     * thing here: the elements are not touched and the wrapper is one
     * allocation.
     *
     * <p>Why a wrapper at all, when the array is already an array: {@code
     * arrays_can_grow} is whole-program, so one {@code push} anywhere puts
     * every array behind this class. That decision is about arrays this
     * compiler allocates; a jar's array is fixed. Adopting is how a foreign
     * array joins a representation it cannot be re-laid-out into -- the
     * alternative was refusing the call, and before that it was a frame that
     * said wrapper over a value that was a bare array, which the verifier
     * caught at class load and nothing caught before.
     *
     * <p><strong>The store stays Java's until it grows.</strong> Writes are
     * visible on both sides, which is what a reference to an array means in
     * either language. A {@code push} past the end reallocates -- the same
     * detachment a JS engine's backing store undergoes -- and after that the
     * two are separate. And a store of the wrong element type throws {@code
     * ArrayStoreException} at the store rather than corrupting the array,
     * which is the covariance hole doing the right thing.
     */
    public static NtsArrayL adopt(Object[] items) {
        return new NtsArrayL(items == null ? EMPTY : items, items == null ? 0 : items.length);
    }
}
