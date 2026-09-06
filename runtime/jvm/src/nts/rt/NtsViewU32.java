package nts.rt;

/** `Uint32Array`: 4-byte elements over an {@link NtsBuffer}.
 *
 * <p>`long` in the read so the top bit is a value rather than a sign; the store is the signed one, because `ToInt32` and `ToUint32` write identical bits. */
public final class NtsViewU32 extends NtsView {
    private NtsViewU32(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared); }

    @Override public int width() { return 4; }

    /** Tracks the buffer's length. */
    public static NtsViewU32 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 4);
        return new NtsViewU32(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewU32 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 4);
        return new NtsViewU32(buffer, at, n);
    }

    /** `new Uint32Array(n)`: its own buffer, zero filled. */
    public static NtsViewU32 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewU32(NtsBuffer.allocate((double) n * 4), 0, n);
    }

    public static double get(NtsViewU32 view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return (((b[a] & 0xFFL) | ((b[a + 1] & 0xFFL) << 8) | ((b[a + 2] & 0xFFL) << 16) | ((b[a + 3] & 0xFFL) << 24)));
    }

    public static void set(NtsViewU32 view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        int x = NtsRuntime.toInt32(v); b[a] = (byte) x; b[a + 1] = (byte) (x >> 8); b[a + 2] = (byte) (x >> 16); b[a + 3] = (byte) (x >> 24);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewU32 subarray(NtsViewU32 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewU32(view.buffer, view.offset + from * 4, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewU32 slice(NtsViewU32 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewU32 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 4,
            out.buffer.bytes, 0, taken * 4);
        return out;
    }

    public static void fill(NtsViewU32 view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }
}
