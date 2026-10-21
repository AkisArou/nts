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
    public static NtsViewI8 create(NtsBuffer buffer, double byteOffset, double length,
                            double kind, boolean tracking) {
        return tracking ? over(buffer, byteOffset) : part(buffer, byteOffset, length);
    }

    public static NtsViewI8 of(double length) {
        int n = NtsBuffer.toIndex(length, "length");
        return new NtsViewI8(NtsBuffer.allocate((double) n * 1), 0, n);
    }

    public static double get(NtsViewI8 view, double index) {
        int a = at(view, index);
        return load(view.buffer.bytes, a);
    }

    public static void set(NtsViewI8 view, double index, double v) {
        int a = at(view, index);
        store(view.buffer.bytes, a, NtsRuntime.toInt32(v));
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static double getAt(NtsViewI8 view, int index) {
        return getInt(view, index);
    }

    /** The index already an `int`; see {@link NtsView#atInt}. */
    public static void setAt(NtsViewI8 view, int index, double v) {
        setInt(view, index, NtsRuntime.toInt32(v));
    }

    /**
     * The element as the JVM holds it, for the indexing path.
     *
     * <p>`getAt` answers in a `double` because that is what the language reads
     * out of a typed array, but HIR types `array.get xs[i]` as the *element* --
     * `u8`, which is an `I` here -- so a backend that used `getAt` would emit a
     * `d2i` per element to undo a widening the runtime had just done. `getAt`
     * is this, widened.
     */
    public static int getInt(NtsViewI8 view, int index) {
        int a = atInt(view, index);
        return load(view.buffer.bytes, a);
    }

    /**
     * <p>The store, for a value already held as an `int`; `setAt` converts a
     * `double` with ToInt32 and stores here, so the conversion stays in one
     * place. An `int`'s own low bits are what ToInt32 then the element's
     * width keep -- `u8[i] = 300` stores 44 by either door, and only `setAt`
     * has a NaN to make 0. This used to widen the `int` and go through
     * `setAt`, which ran ToInt32 on every element a second time: `node-utf8`'s
     * encoder stores ten bytes a character this way.
     */
    public static void setInt(NtsViewI8 view, int index, int value) {
        int a = atInt(view, index);
        store(view.buffer.bytes, a, value);
    }

    /** A read the middle end proved in range; see {@link NtsView#atProved}. */
    public static int getProved(NtsViewI8 view, int index) {
        return load(view.buffer.bytes, atProved(view, index));
    }

    /** A store the middle end proved in range; see {@link NtsView#atProved}. */
    public static void setProved(NtsViewI8 view, int index, int value) {
        store(view.buffer.bytes, atProved(view, index), value);
    }

    /** The element at byte `a`, as `getInt` answers it: every read goes through here. */
    private static int load(byte[] b, int a) {
        return b[a];
    }

    /** And every store, of an `int` whose low bits are the element's. */
    private static void store(byte[] b, int a, int value) {
        b[a] = (byte) value;
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

    @Override double readAt(int index) { return getAt(this, index); }

    @Override void writeAt(int index, double value) { setAt(this, index, value); }
}
