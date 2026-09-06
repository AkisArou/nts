package nts.rt;

/** `Uint8ClampedArray`: 1-byte elements over an {@link NtsBuffer}.
 *
 * <p>`Uint8ClampedArray` is the one that is neither `ToInt32` nor a cast: it clamps to 0..255 and rounds **half to even**, so 0.5 is 0 and 1.5 is 2. See `clamp`. */
public final class NtsViewU8C extends NtsView {
    private NtsViewU8C(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 0); }

    /** Tracks the buffer's length. */
    public static NtsViewU8C over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 1);
        return new NtsViewU8C(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewU8C part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 1);
        return new NtsViewU8C(buffer, at, n);
    }

    /** `new Uint8ClampedArray(n)`: its own buffer, zero filled. */
    public static NtsViewU8C of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewU8C(NtsBuffer.allocate((double) n * 1), 0, n);
    }

    public static double get(NtsViewU8C view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return b[a] & 0xFF;
    }

    public static void set(NtsViewU8C view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        b[a] = (byte) clamp(v);
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewU8C view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return b[a] & 0xFF;
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewU8C view, int index, double v) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        b[a] = (byte) clamp(v);
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewU8C subarray(NtsViewU8C view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewU8C(view.buffer, view.offset + from * 1, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewU8C slice(NtsViewU8C view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewU8C out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 1,
            out.buffer.bytes, 0, taken * 1);
        return out;
    }

    public static void fill(NtsViewU8C view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }
}
