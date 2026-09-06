package nts.rt;

/** `Int16Array`: 2-byte elements over an {@link NtsBuffer}.
 *
 * <p>Little-endian, because a typed array is *platform* order and every platform this runs on is little-endian. `DataView` is where the choice lives. */
public final class NtsViewI16 extends NtsView {
    private NtsViewI16(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 1); }

    /** Tracks the buffer's length. */
    public static NtsViewI16 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 2);
        return new NtsViewI16(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewI16 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 2);
        return new NtsViewI16(buffer, at, n);
    }

    /** `new Int16Array(n)`: its own buffer, zero filled. */
    public static NtsViewI16 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewI16(NtsBuffer.allocate((double) n * 2), 0, n);
    }

    public static double get(NtsViewI16 view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return (short) ((b[a] & 0xFF) | (b[a + 1] << 8));
    }

    public static void set(NtsViewI16 view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        int x = NtsRuntime.toInt32(v); b[a] = (byte) x; b[a + 1] = (byte) (x >> 8);
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewI16 view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return (short) ((b[a] & 0xFF) | (b[a + 1] << 8));
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewI16 view, int index, double v) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        int x = NtsRuntime.toInt32(v); b[a] = (byte) x; b[a + 1] = (byte) (x >> 8);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewI16 subarray(NtsViewI16 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewI16(view.buffer, view.offset + from * 2, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewI16 slice(NtsViewI16 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewI16 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 2,
            out.buffer.bytes, 0, taken * 2);
        return out;
    }

    public static void fill(NtsViewI16 view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }

    @Override double readAt(int index) { return getAt(this, index); }

    @Override void writeAt(int index, double value) { setAt(this, index, value); }
}
