package nts.rt;

/** `Int32Array`: 4-byte elements over an {@link NtsBuffer}. */
public final class NtsViewI32 extends NtsView {
    private NtsViewI32(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared); }

    @Override public int width() { return 4; }

    /** Tracks the buffer's length. */
    public static NtsViewI32 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 4);
        return new NtsViewI32(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewI32 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 4);
        return new NtsViewI32(buffer, at, n);
    }

    /** `new Int32Array(n)`: its own buffer, zero filled. */
    public static NtsViewI32 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewI32(NtsBuffer.allocate((double) n * 4), 0, n);
    }

    public static double get(NtsViewI32 view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return ((b[a] & 0xFF) | ((b[a + 1] & 0xFF) << 8) | ((b[a + 2] & 0xFF) << 16) | (b[a + 3] << 24));
    }

    public static void set(NtsViewI32 view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        int x = NtsRuntime.toInt32(v); b[a] = (byte) x; b[a + 1] = (byte) (x >> 8); b[a + 2] = (byte) (x >> 16); b[a + 3] = (byte) (x >> 24);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewI32 subarray(NtsViewI32 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewI32(view.buffer, view.offset + from * 4, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewI32 slice(NtsViewI32 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewI32 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 4,
            out.buffer.bytes, 0, taken * 4);
        return out;
    }

    public static void fill(NtsViewI32 view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }
}
