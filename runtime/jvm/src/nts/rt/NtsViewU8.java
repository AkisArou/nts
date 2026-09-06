package nts.rt;

/** `Uint8Array`: 1-byte elements over an {@link NtsBuffer}.
 *
 * <p>The same store as `Int8Array`; only the read differs, because the bits are the same and the interpretation is not. */
public final class NtsViewU8 extends NtsView {
    private NtsViewU8(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 0); }

    /** Tracks the buffer's length. */
    public static NtsViewU8 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 1);
        return new NtsViewU8(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewU8 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 1);
        return new NtsViewU8(buffer, at, n);
    }

    /** `new Uint8Array(n)`: its own buffer, zero filled. */
    public static NtsViewU8 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewU8(NtsBuffer.allocate((double) n * 1), 0, n);
    }

    public static double get(NtsViewU8 view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return b[a] & 0xFF;
    }

    public static void set(NtsViewU8 view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        b[a] = (byte) NtsRuntime.toInt32(v);
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewU8 view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return b[a] & 0xFF;
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewU8 view, int index, double v) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        b[a] = (byte) NtsRuntime.toInt32(v);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewU8 subarray(NtsViewU8 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewU8(view.buffer, view.offset + from * 1, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewU8 slice(NtsViewU8 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewU8 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 1,
            out.buffer.bytes, 0, taken * 1);
        return out;
    }

    public static void fill(NtsViewU8 view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }

    @Override double readAt(int index) { return getAt(this, index); }

    @Override void writeAt(int index, double value) { setAt(this, index, value); }
}
