package nts.rt;

/** `Uint32Array`: 4-byte elements over an {@link NtsBuffer}.
 *
 * <p>`long` in the read so the top bit is a value rather than a sign; the store is the signed one, because `ToInt32` and `ToUint32` write identical bits. */
public final class NtsViewU32 extends NtsView {
    private NtsViewU32(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 2); }

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
    /**
     * The lowering's constructor, as `nts_view_new` spells it.
     *
     * <p>A transliteration of the C signature, `kind` and all -- and `kind` is
     * unused here, deliberately. That struct carries a kind because it is one
     * type for nine element widths; this runtime has eleven classes, so the
     * class *is* the kind and the argument is already answered by the method
     * being called at all. Record 0182 is why it is eleven classes: 0.177
     * ns/element through a monomorphic accessor against 0.924 through one that
     * switches.
     *
     * <p>It stays in the signature because the repository's rule for runtime
     * helpers is that the Java transliterates the C header, `double` parameters
     * and all, so that `hir::runtime` remains the single answer about what a
     * helper takes. Dropping it would make this the one helper whose arity a
     * backend decided for itself, and the extern table would need argument
     * surgery no other entry performs.
     */
    public static NtsViewU32 create(NtsBuffer buffer, double byteOffset, double length,
                            double kind, boolean tracking) {
        return tracking ? over(buffer, byteOffset) : part(buffer, byteOffset, length);
    }

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

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewU32 view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return (((b[a] & 0xFFL) | ((b[a + 1] & 0xFFL) << 8) | ((b[a + 2] & 0xFFL) << 16) | ((b[a + 3] & 0xFFL) << 24)));
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewU32 view, int index, double v) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        int x = NtsRuntime.toInt32(v); b[a] = (byte) x; b[a + 1] = (byte) (x >> 8); b[a + 2] = (byte) (x >> 16); b[a + 3] = (byte) (x >> 24);
    }

    /** A view of the same buffer, not a copy. */
    /**
     * The element as the JVM holds it -- and the one class that cannot get
     * there by narrowing its own `double`.
     *
     * <p>`getAt` answers a `u32` as an unsigned value up to 4294967295. `d2i`
     * *saturates*, so 3000000000 would come back as 2147483647 rather than as
     * the wrapped -1294967296 this backend holds a `u32` in. The bytes are read
     * again here instead, which is the same work `getAt` does without the
     * widening that has to be undone.
     */
    public static int getInt(NtsViewU32 view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return (b[a] & 0xFF) | ((b[a + 1] & 0xFF) << 8) | ((b[a + 2] & 0xFF) << 16) | (b[a + 3] << 24);
    }

    /**
     * <p>Through `setAt`, and correct for the wrapped representation: a
     * negative `int` widens to a negative `double`, and `setAt` applies
     * ToUint32, which lands on exactly the bytes it came from.
     */
    public static void setInt(NtsViewU32 view, int index, int value) {
        setAt(view, index, value);
    }

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

    @Override double readAt(int index) { return getAt(this, index); }

    @Override void writeAt(int index, double value) { setAt(this, index, value); }
}
