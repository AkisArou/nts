package nts.rt;

/** `Int8Array`: 1-byte elements over an {@link NtsBuffer}.
 *
 * <p>`ToInt32` and then the low byte, which is what a store to an `Int8Array` is. */
public final class NtsViewI8 extends NtsView {
    private NtsViewI8(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 0); }

    /** Tracks the buffer's length. */
    public static NtsViewI8 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 1);
        return new NtsViewI8(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewI8 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 1);
        return new NtsViewI8(buffer, at, n);
    }

    /** `new Int8Array(n)`: its own buffer, zero filled. */
    public static NtsViewI8 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewI8(NtsBuffer.allocate((double) n * 1), 0, n);
    }

    public static double get(NtsViewI8 view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return b[a];
    }

    public static void set(NtsViewI8 view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        b[a] = (byte) NtsRuntime.toInt32(v);
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewI8 view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return b[a];
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewI8 view, int index, double v) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        b[a] = (byte) NtsRuntime.toInt32(v);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewI8 subarray(NtsViewI8 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewI8(view.buffer, view.offset + from * 1, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewI8 slice(NtsViewI8 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewI8 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 1,
            out.buffer.bytes, 0, taken * 1);
        return out;
    }

    public static void fill(NtsViewI8 view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }
}
