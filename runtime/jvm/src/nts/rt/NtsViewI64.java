package nts.rt;

/**
 * `BigInt64Array`: 8-byte elements over an {@link NtsBuffer}, as {@link NtsBigInt}.
 *
 * <p>The only views whose element is not a `double`. A bigint is 128 bits in
 * this runtime and the element is 64, so a read sign-extends into the high word and a write keeps the low one.
 *
 * <p>Little-endian, because a typed array is platform order and every platform
 * this runs on is little-endian. `DataView` is where the choice lives.
 */
public final class NtsViewI64 extends NtsView {
    private NtsViewI64(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 3); }

    /** Tracks the buffer's length. */
    public static NtsViewI64 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 8);
        return new NtsViewI64(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewI64 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 8);
        return new NtsViewI64(buffer, at, n);
    }

    /** `new BigInt64Array(n)`: its own buffer, zero filled. */
    public static NtsViewI64 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewI64(NtsBuffer.allocate((double) n * 8), 0, n);
    }

    public static NtsBigInt get(NtsViewI64 view, double index) {
        return NtsBigInt.fromLong(read64(view.buffer.bytes, at(view, index)));
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static NtsBigInt getAt(NtsViewI64 view, int index) {
        return NtsBigInt.fromLong(read64(view.buffer.bytes, atInt(view, index)));
    }

    /**
     * The low 64 bits, which is `BigInt.asIntN(64, v)` for the signed view and
     * `asUintN` for the unsigned one -- and the same bits either way, so the
     * two stores are identical and only the reads differ.
     */
    public static void set(NtsViewI64 view, double index, NtsBigInt v) {
        write64(view.buffer.bytes, at(view, index), v.lo);
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewI64 view, int index, NtsBigInt v) {
        write64(view.buffer.bytes, atInt(view, index), v.lo);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewI64 subarray(NtsViewI64 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewI64(view.buffer, view.offset + (from << 3), Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewI64 slice(NtsViewI64 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewI64 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + (from << 3),
            out.buffer.bytes, 0, taken << 3);
        return out;
    }

    public static void fill(NtsViewI64 view, NtsBigInt v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { setAt(view, i, v); }
    }
}
