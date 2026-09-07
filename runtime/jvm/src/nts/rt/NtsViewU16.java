package nts.rt;

/** `Uint16Array`: 2-byte elements over an {@link NtsBuffer}. */
public final class NtsViewU16 extends NtsView {
    private NtsViewU16(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 1); }

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
    public static NtsViewU16 create(NtsBuffer buffer, double byteOffset, double length,
                            double kind, boolean tracking) {
        return tracking ? over(buffer, byteOffset) : part(buffer, byteOffset, length);
    }

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

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewU16 view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return ((b[a] & 0xFF) | ((b[a + 1] & 0xFF) << 8));
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewU16 view, int index, double v) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        int x = NtsRuntime.toInt32(v); b[a] = (byte) x; b[a + 1] = (byte) (x >> 8);
    }

    /** A view of the same buffer, not a copy. */
    /**
     * The element as the JVM holds it, for the indexing path.
     *
     * <p>`getAt` answers in a `double` because that is what the language reads
     * out of a typed array, but HIR types `array.get xs[i]` as the *element* --
     * `u8`, which is an `I` here -- so a backend that used `getAt` would emit a
     * `d2i` per element to undo a widening the runtime had just done.
     *
     * <p>Narrowing back is exact for every element this returns: the widest is
     * `i32`, and a `double` holds every one of those without loss. `u32` is the
     * exception and has its own body -- see there.
     */
    public static int getInt(NtsViewU16 view, int index) {
        return (int) getAt(view, index);
    }

    /**
     * <p>Through `setAt`, so the ECMAScript store conversion stays in one
     * place: `u8[i] = 300` stores 44 and `u8[i] = NaN` stores 0, and those are
     * the runtime's rules rather than the backend's.
     */
    public static void setInt(NtsViewU16 view, int index, int value) {
        setAt(view, index, value);
    }

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

    @Override double readAt(int index) { return getAt(this, index); }

    @Override void writeAt(int index, double value) { setAt(this, index, value); }
}
