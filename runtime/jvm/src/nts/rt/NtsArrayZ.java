package nts.rt;

import java.util.Arrays;

/** Dense growable boolean storage; public double-valued ABI is unchanged. */
public final class NtsArrayZ {
    private static final boolean[] EMPTY = new boolean[0];
    boolean[] items;
    int length;

    private NtsArrayZ(boolean[] items, int length) { this.items = items; this.length = length; }

    public static NtsArrayZ of(double n) {
        int count = Math.max(0, (int) n);
        return new NtsArrayZ(count == 0 ? EMPTY : new boolean[count], count);
    }
    public static NtsArrayZ empty() { return new NtsArrayZ(EMPTY, 0); }
    public static double length(NtsArrayZ a) { return a.length; }
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
    public static boolean get(NtsArrayZ a, double at) {
        return a.items[NtsRuntime.bounds(a.length, at)];
    }

    public static void set(NtsArrayZ a, double at, boolean value) {
        int i = (int) at;
        if (i >= a.length) {
            int wanted = NtsArrays.checkedLength((long) i + 1);
            reserve(a, wanted);
            a.length = wanted;
        }
        a.items[i] = value;
    }
    private static void reserve(NtsArrayZ a, int wanted) {
        if (wanted > a.items.length) {
            a.items = Arrays.copyOf(a.items, NtsArrays.growCapacity(a.items.length, wanted));
        }
    }
    public static double push(NtsArrayZ a, boolean value) {
        int n = NtsArrays.checkedLength((long) a.length + 1);
        reserve(a, n);
        a.items[a.length] = value;
        a.length = n;
        return n;
    }
    /** The nonempty precondition is supplied by lowering; use popValue otherwise. */
    public static boolean pop(NtsArrayZ a) {
        int n = a.length - 1;
        boolean last = a.items[n];
        a.items[n] = false;
        a.length = n;
        return last;
    }
    public static boolean shift(NtsArrayZ a) {
        boolean first = a.items[0];
        int n = a.length - 1;
        System.arraycopy(a.items, 1, a.items, 0, n);
        a.items[n] = false;
        a.length = n;
        return first;
    }
    public static double unshift(NtsArrayZ a, boolean value) {
        int n = NtsArrays.checkedLength((long) a.length + 1);
        reserve(a, n);
        System.arraycopy(a.items, 0, a.items, 1, a.length);
        a.items[0] = value;
        a.length = n;
        return n;
    }
    public static boolean at(NtsArrayZ a, double index) {
        int i = NtsArrays.offset(index, a.length);
        return i < 0 ? false : a.items[i];
    }
    public static double indexOf(NtsArrayZ a, boolean value) {
        boolean[] items = a.items;
        for (int i = 0, n = a.length; i < n; i++) {
            if (items[i] == value) { return i; }
        }
        return -1.0;
    }
    public static double lastIndexOf(NtsArrayZ a, boolean value) {
        boolean[] items = a.items;
        for (int i = a.length - 1; i >= 0; i--) {
            if (items[i] == value) { return i; }
        }
        return -1.0;
    }
    public static boolean includes(NtsArrayZ a, boolean value) {
        return indexOf(a, value) >= 0.0;
    }
    public static NtsArrayZ fill(NtsArrayZ a, boolean value) {
        Arrays.fill(a.items, 0, a.length, value);
        return a;
    }
    public static NtsArrayZ reverse(NtsArrayZ a) {
        boolean[] items = a.items;
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            boolean swap = items[i]; items[i] = items[j]; items[j] = swap;
        }
        return a;
    }
    public static NtsArrayZ slice(NtsArrayZ a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length);
        int end = Math.max(start, NtsArrays.clamp(to, a.length));
        return new NtsArrayZ(start == end ? EMPTY : Arrays.copyOfRange(a.items, start, end), end - start);
    }
    public static NtsArrayZ concat(NtsArrayZ a, NtsArrayZ b) {
        int n = NtsArrays.checkedLength((long) a.length + b.length);
        boolean[] joined = n == 0 ? EMPTY : new boolean[n];
        System.arraycopy(a.items, 0, joined, 0, a.length);
        System.arraycopy(b.items, 0, joined, a.length, b.length);
        return new NtsArrayZ(joined, n);
    }
    public static NtsArrayZ extend(NtsArrayZ a, NtsArrayZ b) {
        int old = a.length;
        int extra = b.length;
        int n = NtsArrays.checkedLength((long) old + extra);
        reserve(a, n);
        // arraycopy supports overlap; a.extend(a) is valid.
        System.arraycopy(b.items, 0, a.items, old, extra);
        a.length = n;
        return a;
    }
    public static void keepFirst(NtsArrayZ a, double count) {
        int keep = Math.max(0, Math.min((int) count, a.length));
        Arrays.fill(a.items, keep, a.length, false);
        a.length = keep;
    }
    public static NtsArrayZ splice(NtsArrayZ a, double at, double count) {
        int start = NtsArrays.clamp(at, a.length);
        int removed = Math.max(0, Math.min((int) count, a.length - start));
        NtsArrayZ taken = new NtsArrayZ(removed == 0 ? EMPTY :
            Arrays.copyOfRange(a.items, start, start + removed), removed);
        if (removed != 0) {
            int old = a.length;
            System.arraycopy(a.items, start + removed, a.items, start, old - start - removed);
            a.length = old - removed;
            Arrays.fill(a.items, a.length, old, false);
        }
        return taken;
    }
    public static String joinStr(NtsArrayZ a, String separator) {
        int n = a.length;
        if (n == 0) { return ""; }
        StringBuilder out = new StringBuilder(NtsArrays.joinCapacity(n, separator, 5));
        for (int i = 0; i < n; i++) {
            if (i != 0) { out.append(separator); }
            out.append(a.items[i]);
        }
        return out.toString();
    }
    public static NtsValue popValue(NtsArrayZ a) {
        return a.length == 0 ? NtsValue.UNDEFINED_VALUE : NtsValue.ofBoolean(pop(a));
    }
    public static NtsValue shiftValue(NtsArrayZ a) {
        return a.length == 0 ? NtsValue.UNDEFINED_VALUE : NtsValue.ofBoolean(shift(a));
    }
    public static NtsValue atValue(NtsArrayZ a, double index) {
        int i = NtsArrays.offset(index, a.length);
        return i < 0 ? NtsValue.UNDEFINED_VALUE : NtsValue.ofBoolean(a.items[i]);
    }
}
