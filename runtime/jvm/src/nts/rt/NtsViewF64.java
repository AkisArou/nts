package nts.rt;

/** `Float64Array`: 8-byte elements over an {@link NtsBuffer}. */
public final class NtsViewF64 extends NtsView {
    private NtsViewF64(NtsBuffer buffer, int offset, int declared) { super(buffer, offset, declared, 3); }

    /** Tracks the buffer's length. */
    public static NtsViewF64 over(NtsBuffer buffer, double byteOffset) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        check(buffer, at, -1, 8);
        return new NtsViewF64(buffer, at, -1);
    }

    /** A fixed number of elements. */
    public static NtsViewF64 part(NtsBuffer buffer, double byteOffset, double length) {
        int at = NtsBuffer.toIndex(byteOffset, "byteOffset");
        int n = NtsBuffer.toIndex(length, "length");
        check(buffer, at, n, 8);
        return new NtsViewF64(buffer, at, n);
    }

    /** `new Float64Array(n)`: its own buffer, zero filled. */
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
    public static NtsViewF64 create(NtsBuffer buffer, double byteOffset, double length,
                            double kind, boolean tracking) {
        return tracking ? over(buffer, byteOffset) : part(buffer, byteOffset, length);
    }

    public static NtsViewF64 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewF64(NtsBuffer.allocate((double) n * 8), 0, n);
    }

    public static double get(NtsViewF64 view, double index) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        return Double.longBitsToDouble(read64(b, a));
    }

    public static void set(NtsViewF64 view, double index, double v) {
        int a = at(view, index);
        byte[] b = view.buffer.bytes;
        write64(b, a, Double.doubleToRawLongBits(v));
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewF64 view, int index) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        return Double.longBitsToDouble(read64(b, a));
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewF64 view, int index, double v) {
        int a = atInt(view, index);
        byte[] b = view.buffer.bytes;
        write64(b, a, Double.doubleToRawLongBits(v));
    }

    /** A view of the same buffer, not a copy. */
    public static NtsViewF64 subarray(NtsViewF64 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        return new NtsViewF64(view.buffer, view.offset + from * 8, Math.max(0, to - from));
    }

    /** A copy, in a buffer of its own. */
    public static NtsViewF64 slice(NtsViewF64 view, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        int taken = Math.max(0, to - from);
        NtsViewF64 out = of(taken);
        System.arraycopy(view.buffer.bytes, view.offset + from * 8,
            out.buffer.bytes, 0, taken * 8);
        return out;
    }

    public static void fill(NtsViewF64 view, double v, double begin, double end) {
        int n = count(view);
        int from = relative(begin, n);
        int to = relative(end, n);
        for (int i = from; i < to; i++) { set(view, i, v); }
    }

    @Override double readAt(int index) { return getAt(this, index); }

    @Override void writeAt(int index, double value) { setAt(this, index, value); }
}
