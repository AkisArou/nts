package nts.rt;

import java.util.Arrays;

/** Dense growable Object storage; public double-valued ABI is unchanged. */
public final class NtsArrayL {
    private static final Object[] EMPTY = new Object[0];
    Object[] items;
    int length;

    private NtsArrayL(Object[] items, int length) { this.items = items; this.length = length; }

    public static NtsArrayL of(double n) {
        int count = Math.max(0, (int) n);
        return new NtsArrayL(count == 0 ? EMPTY : new Object[count], count);
    }
    public static NtsArrayL empty() { return new NtsArrayL(EMPTY, 0); }
    public static double length(NtsArrayL a) { return a.length; }
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
    public static Object get(NtsArrayL a, double at) {
        return a.items[NtsRuntime.bounds(a.length, at)];
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
        int n = NtsArrays.checkedLength((long) a.length + 1);
        reserve(a, n);
        a.items[a.length] = value;
        a.length = n;
        return n;
    }
    /** The nonempty precondition is supplied by lowering; use popValue otherwise. */
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
}
