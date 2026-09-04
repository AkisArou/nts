package nts.rt;

/**
 * An array that can grow: a backing store and a length, so `push` can replace
 * the store without the reference to the array changing.
 *
 * <p>`hir::arrays_can_grow` is a **whole-program** predicate -- one `push`
 * anywhere puts every array in the program behind one of these -- so this is
 * what real code gets and a bare `double[]` is what a benchmark gets. Record
 * 0088 priced the difference at **1.4%** here against **4.02x** on the native
 * lane, and the reason is that the bare array was already this shape: a
 * `double[]` is a heap object with a header, and `xs[i]` is already a reference
 * load, a bounds check against a field, and a load through it. The wrapper adds
 * one field load that C2 hoists out of the loop.
 *
 * <p>One class per element width rather than one generic class, for the reason
 * `nts_runtime.h` gives about its own `fill` family: the compiler knows the
 * element type, and a runtime that had to be told it would be told it wrongly
 * one day. A bare `double[]` is not an `Object[]`, so there is no generic
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
public final class NtsArrayD {
    double[] items;
    int length;

    private NtsArrayD(double[] items, int length) {
        this.items = items;
        this.length = length;
    }

    /** `new Array(n)`: `n` elements, all zero. */
    public static NtsArrayD of(double n) {
        int count = (int) n;
        return new NtsArrayD(new double[Math.max(count, 0)], Math.max(count, 0));
    }

    /** An empty one with room, which is what a literal built by `push` gets. */
    public static NtsArrayD empty() {
        return new NtsArrayD(new double[4], 0);
    }

    public static double length(NtsArrayD a) {
        return a.length;
    }

    public static double get(NtsArrayD a, double at) {
        return a.items[(int) at];
    }

    public static void set(NtsArrayD a, double at, double value) {
        int i = (int) at;
        if (i >= a.length) {
            // Writing past the end grows, which is what `xs[xs.length] = v`
            // does in the language and what a bare array cannot do.
            reserve(a, i + 1);
            a.length = i + 1;
        }
        a.items[i] = value;
    }

    private static void reserve(NtsArrayD a, int wanted) {
        if (wanted <= a.items.length) {
            return;
        }
        int bigger = Math.max(wanted, a.items.length * 2);
        a.items = java.util.Arrays.copyOf(a.items, bigger);
    }

    /** `push`, which answers the new length. */
    public static double push(NtsArrayD a, double value) {
        reserve(a, a.length + 1);
        a.items[a.length++] = value;
        return a.length;
    }

    /** `pop`. The caller has already checked the array is not empty. */
    public static double pop(NtsArrayD a) {
        a.length--;
        double last = a.items[a.length];
        a.items[a.length] = 0.0;
        return last;
    }

    /** `shift`: the first element, and everything else moves down. */
    public static double shift(NtsArrayD a) {
        double first = a.items[0];
        System.arraycopy(a.items, 1, a.items, 0, a.length - 1);
        a.length--;
        a.items[a.length] = 0.0;
        return first;
    }

    /** `unshift`: everything moves up. Answers the new length. */
    public static double unshift(NtsArrayD a, double value) {
        reserve(a, a.length + 1);
        System.arraycopy(a.items, 0, a.items, 1, a.length);
        a.items[0] = value;
        a.length++;
        return a.length;
    }

    /** `at`, where a negative index counts from the end. */
    public static double at(NtsArrayD a, double index) {
                double i = NtsArrays.toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        return i < 0 || i >= a.length ? 0.0 : a.items[(int) i];
    }

    public static double indexOf(NtsArrayD a, double value) {
        for (int i = 0; i < a.length; i++) {
            if (a.items[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static double lastIndexOf(NtsArrayD a, double value) {
        for (int i = a.length - 1; i >= 0; i--) {
            if (a.items[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static boolean includes(NtsArrayD a, double value) {
        return indexOf(a, value) >= 0.0;
    }

    public static NtsArrayD fill(NtsArrayD a, double value) {
        java.util.Arrays.fill(a.items, 0, a.length, value);
        return a;
    }

    /** `reverse` reverses **in place** and answers the same array. */
    public static NtsArrayD reverse(NtsArrayD a) {
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            double swap = a.items[i];
            a.items[i] = a.items[j];
            a.items[j] = swap;
        }
        return a;
    }


    public static NtsArrayD slice(NtsArrayD a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length);
        int end = Math.max(start, NtsArrays.clamp(to, a.length));
        return new NtsArrayD(java.util.Arrays.copyOfRange(a.items, start, end), end - start);
    }

    /** `concat`, which is a new array and leaves both operands alone. */
    public static NtsArrayD concat(NtsArrayD a, NtsArrayD b) {
        double[] joined = java.util.Arrays.copyOf(a.items, a.length + b.length);
        System.arraycopy(b.items, 0, joined, a.length, b.length);
        return new NtsArrayD(joined, a.length + b.length);
    }

    /** Append every element of `b` to `a`, in place. */
    public static NtsArrayD extend(NtsArrayD a, NtsArrayD b) {
        reserve(a, a.length + b.length);
        System.arraycopy(b.items, 0, a.items, a.length, b.length);
        a.length += b.length;
        return a;
    }

    /**
     * `filter`'s first step: keep the first `count`, which is none of them, so
     * the room is there and the length is nothing.
     */
    public static void keepFirst(NtsArrayD a, double count) {
        int keep = Math.max(0, Math.min((int) count, a.length));
        java.util.Arrays.fill(a.items, keep, a.length, 0.0);
        a.length = keep;
    }

    /** `splice`: remove `count` from `at`, and answer what was removed. */
    public static NtsArrayD splice(NtsArrayD a, double at, double count) {
        int start = NtsArrays.clamp(at, a.length);
        int removed = Math.max(0, Math.min((int) count, a.length - start));
        NtsArrayD taken =
            new NtsArrayD(java.util.Arrays.copyOfRange(a.items, start, start + removed), removed);
        System.arraycopy(a.items, start + removed, a.items, start, a.length - start - removed);
        a.length -= removed;
        java.util.Arrays.fill(a.items, a.length, a.length + removed, 0.0);
        return taken;
    }

    public static String joinStr(NtsArrayD a, String separator) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < a.length; i++) {
            if (i > 0) {
                out.append(separator);
            }
            out.append(NtsRuntime.numberToString(a.items[i]));
        }
        return out.toString();
    }

    // ----- the `| undefined` forms ----------------------------------------
    //
    // `pop` and `at` with the `undefined` the checker already gave them. A
    // number has no bit pattern for absence, so `T | undefined` is an erased
    // value and these are what produce one; the plain forms above answer NaN
    // and are reached only where the result was narrowed back to a number.

    public static NtsValue popValue(NtsArrayD a) {
        return a.length == 0 ? NtsValue.ABSENT_NUMBER : NtsValue.ofNumber(pop(a));
    }

    public static NtsValue shiftValue(NtsArrayD a) {
        return a.length == 0 ? NtsValue.ABSENT_NUMBER : NtsValue.ofNumber(shift(a));
    }

    public static NtsValue atValue(NtsArrayD a, double index) {
                double i = NtsArrays.toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        return i < 0 || i >= a.length
            ? NtsValue.ABSENT_NUMBER
            : NtsValue.ofNumber(a.items[(int) i]);
    }

}
