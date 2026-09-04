package nts.rt;

/**
 * An array that can grow: a backing store and a length, so `push` can replace
 * the store without the reference to the array changing.
 *
 * <p>`hir::arrays_can_grow` is a **whole-program** predicate -- one `push`
 * anywhere puts every array in the program behind one of these -- so this is
 * what real code gets and a bare `boolean[]` is what a benchmark gets. Record
 * 0088 priced the difference at **1.4%** here against **4.02x** on the native
 * lane, and the reason is that the bare array was already this shape: a
 * `boolean[]` is a heap object with a header, and `xs[i]` is already a reference
 * load, a bounds check against a field, and a load through it. The wrapper adds
 * one field load that C2 hoists out of the loop.
 *
 * <p>One class per element width rather than one generic class, for the reason
 * `nts_runtime.h` gives about its own `fill` family: the compiler knows the
 * element type, and a runtime that had to be told it would be told it wrongly
 * one day. A bare `boolean[]` is not an `Object[]`, so there is no generic
 * version to fall back to even if one were wanted.
 *
 *
 * <p><b>Why three classes and not one generic one.</b> Java generics are
 * erased, so `T` must be a reference type: `NtsArray<double>` cannot be
 * written, `NtsArray<Double>`'s `T[]` *is* an `Object[]`, and every element
 * becomes a box. Measured on a boolean sieve, `boolean[]` against `Object[]`
 * holding interned `Boolean`s: **108,757 ns against 240,313 ns, 2.2x** -- and
 * that is the *favourable* case, because `Boolean.valueOf` interns and
 * allocates nothing. `Double.valueOf` has no cache, so a `number[]` behind a
 * generic wrapper is one allocation per element as well as one indirection.
 *
 * <p>Three because the JVM has three storage widths that matter here and no
 * way to write one class over them; the same reason `java.util.Arrays` carries
 * eighteen `sort` overloads. Valhalla would close it, and is not in Java 8 --
 * the floor that keeps the Android path open.
 * <p>Every index here is a `double`, matching the C ABI, because that is how
 * this ABI passes a number the compiler knew all along.
 */
public final class NtsArrayZ {
    boolean[] items;
    int length;

    private NtsArrayZ(boolean[] items, int length) {
        this.items = items;
        this.length = length;
    }

    /** `new Array(n)`: `n` elements, all zero. */
    public static NtsArrayZ of(double n) {
        int count = (int) n;
        return new NtsArrayZ(new boolean[Math.max(count, 0)], Math.max(count, 0));
    }

    /** An empty one with room, which is what a literal built by `push` gets. */
    public static NtsArrayZ empty() {
        return new NtsArrayZ(new boolean[4], 0);
    }

    public static double length(NtsArrayZ a) {
        return a.length;
    }

    public static boolean get(NtsArrayZ a, double at) {
        return a.items[(int) at];
    }

    public static void set(NtsArrayZ a, double at, boolean value) {
        int i = (int) at;
        if (i >= a.length) {
            // Writing past the end grows, which is what `xs[xs.length] = v`
            // does in the language and what a bare array cannot do.
            reserve(a, i + 1);
            a.length = i + 1;
        }
        a.items[i] = value;
    }

    private static void reserve(NtsArrayZ a, int wanted) {
        if (wanted <= a.items.length) {
            return;
        }
        int bigger = Math.max(wanted, a.items.length * 2);
        a.items = java.util.Arrays.copyOf(a.items, bigger);
    }

    /** `push`, which answers the new length. */
    public static double push(NtsArrayZ a, boolean value) {
        reserve(a, a.length + 1);
        a.items[a.length++] = value;
        return a.length;
    }

    /** `pop`. The caller has already checked the array is not empty. */
    public static boolean pop(NtsArrayZ a) {
        a.length--;
        boolean last = a.items[a.length];
        a.items[a.length] = false;
        return last;
    }

    /** `shift`: the first element, and everything else moves down. */
    public static boolean shift(NtsArrayZ a) {
        boolean first = a.items[0];
        System.arraycopy(a.items, 1, a.items, 0, a.length - 1);
        a.length--;
        a.items[a.length] = false;
        return first;
    }

    /** `unshift`: everything moves up. Answers the new length. */
    public static double unshift(NtsArrayZ a, boolean value) {
        reserve(a, a.length + 1);
        System.arraycopy(a.items, 0, a.items, 1, a.length);
        a.items[0] = value;
        a.length++;
        return a.length;
    }

    /** `at`, where a negative index counts from the end. */
    public static boolean at(NtsArrayZ a, double index) {
                double i = NtsArrays.toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        return i < 0 || i >= a.length ? false : a.items[(int) i];
    }

    public static double indexOf(NtsArrayZ a, boolean value) {
        for (int i = 0; i < a.length; i++) {
            if (a.items[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static double lastIndexOf(NtsArrayZ a, boolean value) {
        for (int i = a.length - 1; i >= 0; i--) {
            if (a.items[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static boolean includes(NtsArrayZ a, boolean value) {
        return indexOf(a, value) >= 0.0;
    }

    public static NtsArrayZ fill(NtsArrayZ a, boolean value) {
        java.util.Arrays.fill(a.items, 0, a.length, value);
        return a;
    }

    /** `reverse` reverses **in place** and answers the same array. */
    public static NtsArrayZ reverse(NtsArrayZ a) {
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            boolean swap = a.items[i];
            a.items[i] = a.items[j];
            a.items[j] = swap;
        }
        return a;
    }


    public static NtsArrayZ slice(NtsArrayZ a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length);
        int end = Math.max(start, NtsArrays.clamp(to, a.length));
        return new NtsArrayZ(java.util.Arrays.copyOfRange(a.items, start, end), end - start);
    }

    /** `concat`, which is a new array and leaves both operands alone. */
    public static NtsArrayZ concat(NtsArrayZ a, NtsArrayZ b) {
        boolean[] joined = java.util.Arrays.copyOf(a.items, a.length + b.length);
        System.arraycopy(b.items, 0, joined, a.length, b.length);
        return new NtsArrayZ(joined, a.length + b.length);
    }

    /** Append every element of `b` to `a`, in place. */
    public static NtsArrayZ extend(NtsArrayZ a, NtsArrayZ b) {
        reserve(a, a.length + b.length);
        System.arraycopy(b.items, 0, a.items, a.length, b.length);
        a.length += b.length;
        return a;
    }

    /**
     * `filter`'s first step: keep the first `count`, which is none of them, so
     * the room is there and the length is nothing.
     */
    public static void keepFirst(NtsArrayZ a, double count) {
        int keep = Math.max(0, Math.min((int) count, a.length));
        java.util.Arrays.fill(a.items, keep, a.length, false);
        a.length = keep;
    }

    /** `splice`: remove `count` from `at`, and answer what was removed. */
    public static NtsArrayZ splice(NtsArrayZ a, double at, double count) {
        int start = NtsArrays.clamp(at, a.length);
        int removed = Math.max(0, Math.min((int) count, a.length - start));
        NtsArrayZ taken =
            new NtsArrayZ(java.util.Arrays.copyOfRange(a.items, start, start + removed), removed);
        System.arraycopy(a.items, start + removed, a.items, start, a.length - start - removed);
        a.length -= removed;
        java.util.Arrays.fill(a.items, a.length, a.length + removed, false);
        return taken;
    }

    public static String joinStr(NtsArrayZ a, String separator) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < a.length; i++) {
            if (i > 0) {
                out.append(separator);
            }
            out.append(a.items[i] ? "true" : "false");
        }
        return out.toString();
    }

    // ----- the `| undefined` forms ----------------------------------------
    //
    // `pop` and `at` with the `undefined` the checker already gave them. A
    // number has no bit pattern for absence, so `T | undefined` is an erased
    // value and these are what produce one; the plain forms above answer NaN
    // and are reached only where the result was narrowed back to a number.

    public static NtsValue popValue(NtsArrayZ a) {
        return a.length == 0 ? NtsValue.UNDEFINED_VALUE : NtsValue.ofBoolean(pop(a));
    }

    public static NtsValue shiftValue(NtsArrayZ a) {
        return a.length == 0 ? NtsValue.UNDEFINED_VALUE : NtsValue.ofBoolean(shift(a));
    }

    public static NtsValue atValue(NtsArrayZ a, double index) {
                double i = NtsArrays.toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        return i < 0 || i >= a.length
            ? NtsValue.UNDEFINED_VALUE
            : NtsValue.ofBoolean(a.items[(int) i]);
    }

}
