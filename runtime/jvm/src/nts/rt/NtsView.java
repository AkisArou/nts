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

    /**
     * `log2` of the element width, as a field rather than a virtual call.
     *
     * <p>**Measured, after asserting the opposite.** The first version computed
     * the element count as `remaining / width()`, which is a virtual call and
     * an integer division *per element access* -- and the loop then ran at
     * 5.01x a bare `byte[]` for `Uint8Array` and 3.00x for `Float64Array`. The
     * indirection through the buffer was never the cost; it is loop-invariant
     * and C2 hoists it, which was the part that was right. The division was
     * not, and I had not looked.
     *
     * <p>A shift because every element width is a power of two, which is not an
     * accident of this design -- it is what makes a typed array indexable at
     * all.
     */
    final int shift;

    NtsView(NtsBuffer buffer, int offset, int declared, int shift) {
        this.buffer = buffer;
        this.offset = offset;
        this.declared = declared;
        this.shift = shift;
    }

    /** Bytes per element. */
    public final int width() { return 1 << shift; }

    /**
     * One element, virtually, so the bulk operations below can be written once.
     *
     * <p>Virtual dispatch is wrong for `get` on a hot path and right here:
     * `set` and `copyWithin` move whole ranges, so the call is amortised over
     * an element each and the alternative is nine copies of the same loop. The
     * per-element accessors stay static and monomorphic.
     */
    abstract double readAt(int index);

    abstract void writeAt(int index, double value);

    /**
     * `copyWithin`, which is a **move** and not a copy.
     *
     * <p>The source and the destination are the same buffer by construction, so
     * an overlapping range must read as if it had been copied through a
     * temporary -- `copyWithin(2, 0, 5)` on `1..8` is `1,2,1,2,3,4,5,8` and not
     * `1,2,1,2,1,2,1,8`. `System.arraycopy` is specified to behave that way and
     * a hand-written forward loop is not, which is the whole of the difference
     * and is invisible on any non-overlapping input.
     */
    public static void copyWithin(NtsView view, double target, double start, double end) {
        NtsBuffer.alive(view.buffer);
        int n = count(view);
        int to = relative(target, n);
        int from = relative(start, n);
        int last = relative(end, n);
        int taken = Math.min(last - from, n - to);
        if (taken <= 0) { return; }
        System.arraycopy(view.buffer.bytes, view.offset + (from << view.shift),
            view.buffer.bytes, view.offset + (to << view.shift), taken << view.shift);
    }

    /**
     * `set`: copy every element of `source` into `view` starting at `offset`,
     * converting per element.
     *
     * <p>**The same-buffer case reads from a snapshot.** Two views over one
     * buffer can overlap at different element widths, and the specification
     * says the source is read as it was before the write began. Converting in
     * place would let an element already written be read back as a source
     * element -- `u16.set(u16over(sameBuffer, 0, 2), 1)` is the case, and it is
     * wrong only when the ranges overlap.
     *
     * <p>Past the end is a `RangeError` rather than a truncated copy, which is
     * the one place a typed array does refuse rather than ignore.
     */
    public static void set(NtsView view, NtsView source, double offset) {
        NtsBuffer.alive(view.buffer);
        NtsBuffer.alive(source.buffer);
        int at = NtsBuffer.toIndex(offset, "offset");
        int taken = count(source);
        if (at + (long) taken > count(view)) {
            throw new NtsRefusal("a RangeError: " + taken + " elements at " + at
                + " is past the end of a " + count(view) + " element view");
        }
        if (view.buffer == source.buffer) {
            double[] snapshot = new double[taken];
            for (int i = 0; i < taken; i++) { snapshot[i] = source.readAt(i); }
            for (int i = 0; i < taken; i++) { view.writeAt(at + i, snapshot[i]); }
            return;
        }
        for (int i = 0; i < taken; i++) { view.writeAt(at + i, source.readAt(i)); }
    }

    /** `indexOf`, and `-1` where there is none. Strict equality, so NaN is never found. */
    public static double indexOf(NtsView view, double value, double from) {
        NtsBuffer.alive(view.buffer);
        int n = count(view);
        for (int i = relative(from, n); i < n; i++) {
            if (view.readAt(i) == value) { return i; }
        }
        return -1;
    }

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
        return rest <= 0 ? 0 : rest >> view.shift;
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
        if (view.buffer.bytes == null) {
            throw new NtsRefusal("a TypeError: the ArrayBuffer is detached");
        }
        // Inlined rather than calling `count`, so the fast path is one branch
        // on `declared` and not a second read of the buffer's null-ness. The
        // shift is the whole of the arithmetic.
        int n = view.declared;
        if (n < 0) {
            int rest = view.buffer.length - view.offset;
            n = rest <= 0 ? 0 : rest >> view.shift;
        }
        int i = (int) index;
        if (i != index || i < 0 || i >= n) {
            return outside(index, n);
        }
        return view.offset + (i << view.shift);
    }

    /**
     * The same check with the index already an `int`.
     *
     * <p>The `double` form exists because `hir::runtime` types every index as
     * one, and it costs an `i2d` and a `d2i` per element plus the
     * integrality test -- which is the whole gap between a view loop and an
     * array loop, measured at 5.22x before this existed. `intcall` selects this
     * form where the middle end has already proved the index integral, which is
     * the same move record 0138 made for the array subscript and found 4.56x.
     */
    static int atInt(NtsView view, int i) {
        if (view.buffer.bytes == null) {
            throw new NtsRefusal("a TypeError: the ArrayBuffer is detached");
        }
        int n = view.declared;
        if (n < 0) {
            int rest = view.buffer.length - view.offset;
            n = rest <= 0 ? 0 : rest >> view.shift;
        }
        if (i < 0 || i >= n) {
            return outside(i, n);
        }
        return view.offset + (i << view.shift);
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
