package nts.rt;

/**
 * An `ArrayBuffer`: bytes, and the two things that can happen to them.
 *
 * <h2>Why the views hold this and not the array</h2>
 *
 * A `byte[]` on this platform cannot grow in place, so `resize` and `transfer`
 * both replace it. A view that held the array directly would keep reading the
 * old one -- silently, and only for programs that resize, which is the shape a
 * test corpus is least likely to contain. So a view holds the buffer and reads
 * {@link #bytes} through it, which costs one field load per access.
 *
 * <p>That load is not free and it is not the cost it looks like: in a loop over
 * a view, nothing writes `bytes`, so it is loop-invariant and hoisted. What it
 * would cost in a loop that resizes is exactly what it is there to pay.
 *
 * <h2>Detaching</h2>
 *
 * A detached buffer has `null` bytes rather than a flag, so every access path
 * checks it whether or not its author remembered to: the one that forgets gets
 * a `NullPointerException` at the access rather than a wrong answer somewhere
 * later. The paths that do remember turn it into a refusal naming the cause.
 *
 * <p>JavaScript raises a `TypeError` for a detached buffer and a `RangeError`
 * for an out-of-range access. Until an exception can cross a call on this
 * backend those are both refusals, and the messages say which error the program
 * would have seen so the mapping is mechanical when it exists.
 */
public final class NtsBuffer {
    /** Null once detached. Package-visible so views read it without a call. */
    byte[] bytes;

    /**
     * `byteLength`, and **not** `bytes.length`: a resizable buffer reserves its
     * maximum, so the array is longer than the buffer almost always. Every read
     * of the contents bounds itself by this.
     */
    int length;

    /** `maxByteLength`, and equal to the length when the buffer is fixed. */
    final int maxLength;

    final boolean resizable;

    private NtsBuffer(byte[] bytes, int length, int maxLength, boolean resizable) {
        this.bytes = bytes;
        this.length = length;
        this.maxLength = maxLength;
        this.resizable = resizable;
    }

    /** `new ArrayBuffer(n)`. Zero filled, and fixed. */
    public static NtsBuffer allocate(double byteLength) {
        int n = size(byteLength, "byteLength");
        return new NtsBuffer(reserve(n), n, n, false);
    }

    /**
     * The block, and the distinction node draws between two things that both
     * look like "too big".
     *
     * <p>`RangeError: Invalid array buffer length` is what the *language*
     * refuses; `RangeError: Array buffer allocation failed` is what the
     * *machine* could not do. They are different sentences on purpose, and an
     * `OutOfMemoryError` is neither -- it is an error of a different kind,
     * escaping into a harness that reads anything but a refusal as a defect.
     *
     * <p>The boundary between them cannot be matched: it is however much memory
     * is free. So the rule is implemented and the allocation is left to be the
     * allocation.
     */
    private static byte[] reserve(int n) {
        try {
            return new byte[n];
        } catch (OutOfMemoryError exhausted) {
            throw new NtsRefusal("a RangeError: Array buffer allocation failed");
        }
    }

    /**
     * `new ArrayBuffer(n, { maxByteLength: m })`.
     *
     * <p>**The maximum is reserved now**, which is what the C runtime does and
     * is the reason to do it here: `nts_buffer_new_resizable` says the reserved
     * block is what makes the address stable, so a view never re-reads where
     * the bytes are and `resize` is an assignment. Growing by copying instead
     * would have been cheaper for a program that declares a large maximum and
     * never uses it, and it would have given the two lanes different allocation
     * behaviour, different failure points and different answers to "can this
     * resize fail". One of those is a performance difference and the rest are
     * semantics.
     */
    public static NtsBuffer allocateResizable(double byteLength, double maxByteLength) {
        int n = size(byteLength, "byteLength");
        int max = size(maxByteLength, "maxByteLength");
        if (n > max) {
            throw new NtsRefusal(
                "a RangeError: byteLength " + n + " exceeds maxByteLength " + max);
        }
        return new NtsBuffer(reserve(max), n, max, true);
    }

    public static double byteLength(NtsBuffer buffer) { return buffer.length; }
    public static double maxByteLength(NtsBuffer buffer) { return buffer.maxLength; }
    public static boolean resizable(NtsBuffer buffer) { return buffer.resizable; }
    public static boolean detached(NtsBuffer buffer) { return buffer.bytes == null; }

    /**
     * `ArrayBuffer.prototype.resize`.
     *
     * <p>An assignment and a `memset`, because the maximum is already reserved.
     *
     * <p>**Growth zeroes what it exposes, and that is not redundant.** The
     * reserved block was zero when it was allocated, so the obvious reading is
     * that nothing needs clearing -- but a `resize` down and back up again
     * would otherwise show whatever the shrunk region held, which is memory the
     * program deliberately discarded. The C runtime says the same thing at the
     * same place; this is one behaviour written twice and it is the kind that
     * is only wrong on the second resize.
     */
    public static void resize(NtsBuffer buffer, double byteLength) {
        alive(buffer);
        if (!buffer.resizable) {
            throw new NtsRefusal("a TypeError: resize on a buffer that is not resizable");
        }
        int n = size(byteLength, "byteLength");
        if (n > buffer.maxLength) {
            throw new NtsRefusal(
                "a RangeError: resize to " + n + " exceeds maxByteLength " + buffer.maxLength);
        }
        if (n > buffer.length) {
            java.util.Arrays.fill(buffer.bytes, buffer.length, n, (byte) 0);
        }
        buffer.length = n;
    }

    /** `ArrayBuffer.prototype.slice`, with JavaScript's relative indices. */
    public static NtsBuffer slice(NtsBuffer buffer, double begin, double end) {
        alive(buffer);
        int from = relative(begin, buffer.length);
        int to = relative(end, buffer.length);
        int n = Math.max(0, to - from);
        byte[] taken = reserve(n);
        System.arraycopy(buffer.bytes, from, taken, 0, n);
        return new NtsBuffer(taken, n, n, false);
    }

    /**
     * `ArrayBuffer.prototype.transfer`. The source is detached and keeps
     * nothing.
     *
     * <p>The array is *moved* when the length is unchanged, which is the point
     * of `transfer` over `slice` -- a program handing a megabyte to another
     * owner should not pay a megabyte to do it. A different length copies,
     * because the array is a different size.
     */
    public static NtsBuffer transfer(NtsBuffer buffer, double newLength, boolean fixed) {
        alive(buffer);
        // No NaN sentinel for "no argument given". `transfer(NaN)` is
        // `ToIndex(NaN)`, which is **zero**, so a runtime that read NaN as
        // "keep the length" answered the old length where node answers an
        // empty buffer -- one case in 841, and invisible to any test that
        // passes a real number. An absent argument is the caller's to resolve,
        // and the middle end resolves it by passing the current length.
        int n = size(newLength, "newLength");
        boolean stays = buffer.resizable && !fixed;
        int max = stays ? Math.max(n, buffer.maxLength) : n;
        byte[] moved;
        if (buffer.bytes.length == max) {
            // The reserved block is already the size the result reserves, so
            // this is the move `transfer` exists to be -- a megabyte handed to
            // a new owner without a megabyte of copying.
            moved = buffer.bytes;
        } else {
            moved = reserve(max);
            System.arraycopy(buffer.bytes, 0, moved, 0, Math.min(n, buffer.length));
        }
        // Past the old length is whatever a shrink left there, and the new
        // buffer is longer, so it is exposed and must read as zero.
        if (n > buffer.length) {
            java.util.Arrays.fill(moved, buffer.length, n, (byte) 0);
        }
        buffer.bytes = null;
        buffer.length = 0;
        return new NtsBuffer(moved, n, max, stays);
    }

    /**
     * The reserved block, whose length is the buffer's *maximum* and not its
     * `byteLength`. A caller that wants the contents bounds itself by
     * {@link #byteLength}.
     */
    public static byte[] storage(NtsBuffer buffer) {
        alive(buffer);
        return buffer.bytes;
    }

    static void alive(NtsBuffer buffer) {
        if (buffer.bytes == null) {
            throw new NtsRefusal("a TypeError: the ArrayBuffer is detached");
        }
    }

    /**
     * `ToIndex`, which is not the check this had and is the one the language
     * specifies.
     *
     * <p>This rejected any non-integer, on the reasoning that one `n != value`
     * comparison catches a fraction, a NaN, an infinity and an overflow at
     * once. It does, and three of those four are wrong: `ToIndex` runs
     * `ToIntegerOrInfinity` first, so **`0.5` is 0 and `NaN` is 0**, and only a
     * negative or a value past 2^53-1 is a `RangeError`. Node allows
     * `new DataView(b, 0.5)` and reads element zero.
     *
     * <p>Found by the oracle rather than by reading the specification, which is
     * the point of having one: the strict version looked more careful and was a
     * refusal of programs node accepts.
     *
     * <p>The `Integer.MAX_VALUE` ceiling is this runtime's and not the
     * language's -- a `byte[]` cannot be longer -- so it is reported as what it
     * is rather than as a `RangeError` the program could have predicted.
     */
    /**
     * `nts_to_index`, as a number, transliterated from the C runtime.
     *
     * <p>The middle end composes this with its own comparisons -- a maximum of
     * `NaN` has to become zero *before* it is compared to a length, because
     * every comparison with NaN is false and the throw simply does not happen
     * -- so it must answer exactly what the other lane answers, including where
     * that is not `ToIndex`. It is not: `!(value >= 1.0)` sends everything
     * below one to zero, negatives included, where the specification's
     * `ToIndex` raises a `RangeError` for anything under zero. The range check
     * lives above this on both lanes.
     */
    public static double toIndexNumber(double value) {
        if (!(value >= 1.0)) { return 0.0; }
        return value < 0.0 ? Math.ceil(value) : Math.floor(value);
    }

    static int toIndex(double value, String what) {
        double integer = Double.isNaN(value) ? 0.0
            : value < 0.0 ? Math.ceil(value) : Math.floor(value);
        if (integer < 0.0 || integer > 9007199254740991.0) {
            throw new NtsRefusal("a RangeError: " + what + " "
                + NtsRuntime.numberText(value) + " is not an index");
        }
        if (integer > Integer.MAX_VALUE) {
            throw new NtsRefusal(what + " " + NtsRuntime.numberText(value)
                + " is larger than this runtime can allocate");
        }
        return (int) integer;
    }

    private static int size(double value, String what) { return toIndex(value, what); }

    /**
     * JavaScript's relative index: truncate toward zero, then negative counts
     * from the end, then clamp.
     *
     * <p>**`Math.floor` is not the truncation**, and that was this function's
     * bug. `ToIntegerOrInfinity(-0.5)` is `-0`, so `slice(-0.5)` starts at the
     * *beginning*; `Math.floor(-0.5)` is `-1`, which counts one back from the
     * end instead. The two agree on every non-negative input, which is every
     * input a slice test is likely to contain, and disagree on the whole of
     * `(-1, 0)`. The differential found it at 2 of 841 cases.
     *
     * <p>It is the same rule the other lane got wrong three times in one
     * afternoon, in three different spellings. One rule, and it reads like two:
     * truncate toward zero, *then* interpret.
     */
    private static int relative(double index, int length) {
        double at = Double.isNaN(index) ? 0.0
            : index < 0.0 ? Math.ceil(index) : Math.floor(index);
        if (at < 0.0) { at += length; }
        if (at < 0.0) { return 0; }
        if (at > length) { return length; }
        return (int) at;
    }
}
