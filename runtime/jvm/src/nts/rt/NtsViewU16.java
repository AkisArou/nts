package nts.rt;

/** `Uint16Array`: 2-byte elements over an {@link NtsBuffer}. */
public final class NtsViewU16 extends NtsView {
    private NtsViewU16(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared); }

    @Override public int width() { return 2; }

    /** Tracks the buffer's length. */
    public static NtsViewU16 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 2);
        return new NtsViewU16(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewU16 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 2);
        return new NtsViewU16(buffer, at, n);
    }

    /** `new Uint16Array(n)`: its own buffer, zero filled. */
    public static NtsViewU16 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewU16(NtsBuffer.allocate((double) n * 2), 0, n);
    }

    public static double get(NtsViewU16 view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return ((b[a] & 0xFF) | ((b[a + 1] & 0xFF) << 8));
    }

    public static void set(NtsViewU16 view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        int x = NtsRuntime.toInt32(v); b[a] = (byte) x; b[a + 1] = (byte) (x >> 8);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewU16 subarray(NtsViewU16 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewU16(view.buffer, view.offset + from * 2, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewU16 slice(NtsViewU16 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewU16 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 2,
            out.buffer.bytes, 0, taken * 2);
        return out;
    }

    public static void fill(NtsViewU16 view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }
}
