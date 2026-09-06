package nts.rt;

/**
 * A typed array: a window on an {@link NtsBuffer} with an element type.
 *
 * <h2>Why the buffer and not the byte array</h2>
 *
 * A view holds the buffer and reads {@link NtsBuffer#bytes} through it, which
 * costs one field load per access. `transfer` replaces the array, so a view
 * that held it directly would keep reading the old one -- silently, and only
 * for programs that transfer. In a loop nothing writes `bytes`, so the load is
 * loop-invariant and hoisted; what it costs in a loop that transfers is exactly
 * what it is there to pay.
 *
 * <h2>Length, and the two kinds of view</h2>
 *
 * A view built with an explicit length has it for life. A view built without
 * one **tracks** the buffer: shrink the buffer and the view is shorter, grow it
 * and the view is longer. That is not a convenience, it is the specification,
 * and it is why {@link #length} is computed rather than stored -- a stored
 * length would be right until the first `resize` and wrong afterwards, which is
 * the shape of bug a test corpus without resizable buffers never sees.
 *
 * <h2>Out of bounds refuses, and that is this repository's answer rather than
 * the language's</h2>
 *
 * JavaScript reads a typed array out of bounds as `undefined` and writes out of
 * bounds by doing nothing. NTS arrays already refuse instead -- `nts_bounds`
 * raises rather than returning an absence a typed program has nowhere to put --
 * and a typed array that behaved differently from an ordinary one would be a
 * second answer to the same question. So it refuses, for the same reason and
 * with the same message shape.
 *
 * <p>The element conversions are **not** a local decision and are node's
 * exactly: `ToInt32` for the signed and unsigned integer views, round-to-even
 * for `Float32Array`, and `Uint8ClampedArray`'s own rounding, which is neither
 * of those.
 */
public abstract class NtsView {
    final NtsBuffer buffer;
    final int offset;
    /** `-1` when the view tracks the buffer's length. */
    final int declared;

    NtsView(NtsBuffer buffer, int offset, int declared) {
        this.buffer = buffer;
        this.offset = offset;
        this.declared = declared;
    }

    /** Bytes per element. */
    public abstract int width();

    public static NtsBuffer buffer(NtsView view) { return view.buffer; }
    public static double byteOffset(NtsView view) { return view.offset; }

    public static double length(NtsView view) { return count(view); }

    public static double byteLength(NtsView view) { return (long) count(view) * view.width(); }

    /**
     * How many elements the view has *now*.
     *
     * <p>A tracking view over a buffer whose remaining bytes do not divide by
     * the element width reports the whole elements only -- three bytes of a
     * `Uint16Array` is one element, not one and a half, and not an out-of-range
     * read of the fourth byte.
     */
    static int count(NtsView view) {
        if (view.buffer.bytes == null) { return 0; }
        if (view.declared >= 0) { return view.declared; }
        int rest = view.buffer.length - view.offset;
        return rest <= 0 ? 0 : rest / view.width();
    }

    /**
     * The byte index of element `at`, checked against the buffer as it is now.
     *
     * <p>`(long)` on the multiply and the sum: an index near `Integer.MAX_VALUE`
     * times an element width overflows and wraps to a *valid-looking* small
     * number, which is a bounds check that passes for an access that is out of
     * bounds.
     */
    static int at(NtsView view, double index) {
        NtsBuffer.alive(view.buffer);
        int i = (int) index;
        if (i != index || i < 0 || i >= count(view)) {
            return outside(index, count(view));
        }
        return view.offset + i * view.width();
    }

    private static int outside(double index, int length) {
        throw new NtsRefusal(
            "index " + NtsRuntime.numberText(index) + " is outside [0, " + length + ")");
    }

    /**
     * `new Uint8Array(buffer, byteOffset)` -- tracking -- or with a length.
     *
     * <p>The offset must divide by the element width. `new Uint32Array(buffer,
     * 3)` is a `RangeError` in the language and would be an unaligned read
     * here, which on a `byte[]` is merely wrong rather than a fault -- so it is
     * refused rather than allowed to produce a number nobody asked for.
     */
    static void check(NtsBuffer buffer, int offset, int declared, int width) {
        NtsBuffer.alive(buffer);
        if (offset % width != 0) {
            throw new NtsRefusal("a RangeError: byteOffset " + offset
                + " is not a multiple of the " + width + " byte element");
        }
        if (offset > buffer.length) {
            throw new NtsRefusal("a RangeError: byteOffset " + offset
                + " is past the end of a " + buffer.length + " byte buffer");
        }
        if (declared >= 0 && offset + (long) declared * width > buffer.length) {
            throw new NtsRefusal("a RangeError: " + declared + " elements of " + width
                + " bytes at " + offset + " is past the end of a " + buffer.length
                + " byte buffer");
        }
    }

    static long read64(byte[] b, int a) {
        return (b[a] & 0xFFL) | ((b[a + 1] & 0xFFL) << 8) | ((b[a + 2] & 0xFFL) << 16)
            | ((b[a + 3] & 0xFFL) << 24) | ((b[a + 4] & 0xFFL) << 32) | ((b[a + 5] & 0xFFL) << 40)
            | ((b[a + 6] & 0xFFL) << 48) | ((b[a + 7] & 0xFFL) << 56);
    }

    static void write64(byte[] b, int a, long v) {
        for (int i = 0; i < 8; i++) { b[a + i] = (byte) (v >>> (8 * i)); }
    }

    /**
     * `Uint8ClampedArray`'s conversion, which is neither `ToInt32` nor a cast.
     *
     * <p>Clamp to 0..255, then round **half to even**: 0.5 is 0, 1.5 is 2, 2.5
     * is 2. `Math.round` is half-up and would give 1, 2, 3 -- wrong on exactly
     * the inputs that distinguish the two rules, which are the ones a test is
     * least likely to contain unless it is looking for this.
     *
     * <p>NaN is zero, which falls out of the comparison rather than needing a
     * case: every comparison with NaN is false, so it reaches neither clamp and
     * lands on the rounding of a value that is not a number -- so it is checked
     * first.
     */
    static int clamp(double v) {
        if (Double.isNaN(v)) { return 0; }
        if (v <= 0.0) { return 0; }
        if (v >= 255.0) { return 255; }
        double floor = Math.floor(v);
        double rest = v - floor;
        if (rest < 0.5) { return (int) floor; }
        if (rest > 0.5) { return (int) floor + 1; }
        return ((int) floor % 2 == 0) ? (int) floor : (int) floor + 1;
    }

    /** JavaScript's relative index, truncating toward zero. See `NtsBuffer`. */
    static int relative(double index, int length) {
        double a = Double.isNaN(index) ? 0.0
            : index < 0.0 ? Math.ceil(index) : Math.floor(index);
        if (a < 0.0) { a += length; }
        if (a < 0.0) { return 0; }
        if (a > length) { return length; }
        return (int) a;
    }
}
