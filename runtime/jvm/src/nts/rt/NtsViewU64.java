package nts.rt;

/**
 * `BigUint64Array`: 8-byte elements over an {@link NtsBuffer}, as {@link NtsBigInt}.
 *
 * <p>The only views whose element is not a `double`. A bigint is 128 bits in
 * this runtime and the element is 64, so a read zero-fills the high word and a write keeps the low one.
 *
 * <p>Little-endian, because a typed array is platform order and every platform
 * this runs on is little-endian. `DataView` is where the choice lives.
 */
public final class NtsViewU64 extends NtsView {
    private NtsViewU64(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 3); }

    /** Tracks the buffer's length. */
    public static NtsViewU64 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 8);
        return new NtsViewU64(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewU64 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 8);
        return new NtsViewU64(buffer, at, n);
    }

    /** `new BigUint64Array(n)`: its own buffer, zero filled. */
    public static NtsViewU64 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewU64(NtsBuffer.allocate((double) n * 8), 0, n);
    }

    public static NtsBigInt get(NtsViewU64 view, double index) {
        return unsigned(read64(view.buffer.bytes, at(view, index)));
    }

    /** Zero in the high word, so the top bit is a value and not a sign. */
    private static NtsBigInt unsigned(long low) { return NtsBigInt.of(0L, low); }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static NtsBigInt getAt(NtsViewU64 view, int index) {
        return unsigned(read64(view.buffer.bytes, atInt(view, index)));
    }

    /**
     * The low 64 bits, which is `BigInt.asIntN(64, v)` for the signed view and
     * `asUintN` for the unsigned one -- and the same bits either way, so the
     * two stores are identical and only the reads differ.
     */
    public static void set(NtsViewU64 view, double index, NtsBigInt v) {
        write64(view.buffer.bytes, at(view, index), v.lo);
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewU64 view, int index, NtsBigInt v) {
        write64(view.buffer.bytes, atInt(view, index), v.lo);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewU64 subarray(NtsViewU64 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewU64(view.buffer, view.offset + (from << 3), Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewU64 slice(NtsViewU64 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewU64 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + (from << 3),
            out.buffer.bytes, 0, taken << 3);
        return out;
    }

    public static void fill(NtsViewU64 view, NtsBigInt v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { setAt(view, i, v); }
    }

    /**
     * A bigint element is not a `double`, and mixing is a `TypeError` in the
     * language rather than a conversion -- *"Cannot mix BigInt and other
     * types"*. So the generic bulk operations refuse here rather than lose the
     * top bits silently, and the bigint views have their own {@link #set} and
     * inherit `copyWithin`, which moves bytes and does not care what they mean.
     */
    @Override double readAt(int index) {
        throw new NtsRefusal("a TypeError: cannot mix BigInt and other types");
    }

    @Override void writeAt(int index, double value) {
        throw new NtsRefusal("a TypeError: cannot mix BigInt and other types");
    }

    /** Elementwise, and the same-buffer case reads from a snapshot. */
    public static void set(NtsViewU64 view, NtsViewU64 source, double offset) {
        NtsBuffer.alive(view.buffer);
        NtsBuffer.alive(source.buffer);
        int at = NtsBuffer.toIndex(offset, "offset");
        int taken = count(source);
        if (at + (long) taken > count(view)) {
            throw new NtsRefusal("a RangeError: " + taken + " elements at " + at
                + " is past the end of a " + count(view) + " element view");
        }
        long[] snapshot = new long[taken];
        for (int i = 0; i < taken; i++) { snapshot[i] = read64(source.buffer.bytes, atInt(source, i)); }
        for (int i = 0; i < taken; i++) { write64(view.buffer.bytes, atInt(view, at + i), snapshot[i]); }
    }
}
