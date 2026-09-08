package nts.rt;

/**
 * A `DataView`: a window on an {@link NtsBuffer} with explicit endianness.
 *
 * <h2>Three things that are easy to get wrong and are wrong silently</h2>
 *
 * <b>The default is big-endian.</b> Every typed array is platform order and
 * every `DataView` accessor is big-endian unless told otherwise -- the one
 * place in the language where the default is the *less* common byte order.
 * Getting it backwards is correct on symmetric values and wrong on the rest.
 *
 * <b>NaN payloads must survive.</b> `Float.floatToIntBits` canonicalises every
 * NaN to `0x7fc00000`, so a program that writes a signalling NaN and reads it
 * back gets a different bit pattern than node gives. `floatToRawIntBits` and
 * `doubleToRawLongBits` are the ones that do not, and the differential compares
 * by bit pattern, so this is a visible disagreement rather than a nicety.
 *
 * <b>Unaligned access is legal.</b> `getFloat64(1)` is an ordinary read in
 * JavaScript. Assembling from bytes rather than reaching for a wider primitive
 * is what makes that true here without a special case.
 *
 * <h2>Bounds</h2>
 *
 * Checked against the buffer's *current* length on every access, not against
 * the length the view was made with. A resizable buffer can shrink under a
 * view, and a view that trusted its construction-time length would read the
 * array past its end -- which on this platform is an
 * `ArrayIndexOutOfBoundsException` escaping into the harness rather than a
 * refusal, and the differential reads that as a defect on a case the other
 * lanes decline.
 */
public final class NtsDataView extends NtsAnyView {
    private NtsDataView(NtsBuffer buffer, int offset, int declared) {
        super(buffer, offset, declared);
    }

    /** `new DataView(buffer, byteOffset)` -- tracks the buffer's length. */
    public static NtsDataView over(NtsBuffer buffer, double byteOffset) {
        NtsBuffer.alive(buffer);
        int at = index(byteOffset, "byteOffset");
        if (at > buffer.length) {
            throw new NtsRefusal("a RangeError: byteOffset " + at
                + " is past the end of a " + buffer.length + " byte buffer");
        }
        return new NtsDataView(buffer, at, -1);
    }

    /** `new DataView(buffer, byteOffset, byteLength)`. */
    public static NtsDataView part(NtsBuffer buffer, double byteOffset, double byteLength) {
        NtsBuffer.alive(buffer);
        int at = index(byteOffset, "byteOffset");
        int n = index(byteLength, "byteLength");
        if (at + (long) n > buffer.length) {
            throw new NtsRefusal("a RangeError: a " + n + " byte view at " + at
                + " is past the end of a " + buffer.length + " byte buffer");
        }
        return new NtsDataView(buffer, at, n);
    }

    public static NtsBuffer buffer(NtsDataView view) { return view.buffer; }
    public static double byteOffset(NtsDataView view) { return view.offset; }

    /** {@link NtsAnyView#byteLength()}, delegating to the static below. */
    @Override public double byteLength() { return byteLength(this); }

    public static double byteLength(NtsDataView view) {
        NtsBuffer.alive(view.buffer);
        return length(view);
    }

    private static int length(NtsDataView view) {
        if (view.declared >= 0) { return view.declared; }
        int rest = view.buffer.length - view.offset;
        return rest < 0 ? 0 : rest;
    }

    /**
     * The absolute index of a `width`-byte access, checked.
     *
     * <p>`(long)` on the sum: a view at a large offset plus a large index
     * overflows `int` and wraps to a *valid-looking* small number, which is a
     * bounds check that passes for an access that is out of bounds. The
     * arithmetic is the check, so it is done where it cannot wrap.
     */
    private static int at(NtsDataView view, double byteOffset, int width) {
        NtsBuffer.alive(view.buffer);
        int i = NtsBuffer.toIndex(byteOffset, "byteOffset");
        if (i + (long) width > length(view)) {
            throw new NtsRefusal("a RangeError: a " + width + " byte access at " + i
                + " is outside a " + length(view) + " byte view");
        }
        return view.offset + i;
    }

    private static int u8(byte[] bytes, int at) { return bytes[at] & 0xFF; }

    private static int read16(NtsDataView view, double byteOffset, boolean little) {
        int at = at(view, byteOffset, 2);
        byte[] bytes = view.buffer.bytes;
        return little
            ? u8(bytes, at) | (u8(bytes, at + 1) << 8)
            : (u8(bytes, at) << 8) | u8(bytes, at + 1);
    }

    private static int read32(NtsDataView view, double byteOffset, boolean little) {
        int at = at(view, byteOffset, 4);
        byte[] bytes = view.buffer.bytes;
        return little
            ? u8(bytes, at) | (u8(bytes, at + 1) << 8) | (u8(bytes, at + 2) << 16) | (u8(bytes, at + 3) << 24)
            : (u8(bytes, at) << 24) | (u8(bytes, at + 1) << 16) | (u8(bytes, at + 2) << 8) | u8(bytes, at + 3);
    }

    private static long read64(NtsDataView view, double byteOffset, boolean little) {
        int at = at(view, byteOffset, 8);
        byte[] bytes = view.buffer.bytes;
        long value = 0L;
        if (little) {
            for (int i = 7; i >= 0; i--) { value = (value << 8) | u8(bytes, at + i); }
        } else {
            for (int i = 0; i < 8; i++) { value = (value << 8) | u8(bytes, at + i); }
        }
        return value;
    }

    private static void write16(NtsDataView view, double byteOffset, int value, boolean little) {
        int at = at(view, byteOffset, 2);
        byte[] bytes = view.buffer.bytes;
        if (little) {
            bytes[at] = (byte) value; bytes[at + 1] = (byte) (value >> 8);
        } else {
            bytes[at] = (byte) (value >> 8); bytes[at + 1] = (byte) value;
        }
    }

    private static void write32(NtsDataView view, double byteOffset, int value, boolean little) {
        int at = at(view, byteOffset, 4);
        byte[] bytes = view.buffer.bytes;
        if (little) {
            bytes[at] = (byte) value;
            bytes[at + 1] = (byte) (value >> 8);
            bytes[at + 2] = (byte) (value >> 16);
            bytes[at + 3] = (byte) (value >> 24);
        } else {
            bytes[at] = (byte) (value >> 24);
            bytes[at + 1] = (byte) (value >> 16);
            bytes[at + 2] = (byte) (value >> 8);
            bytes[at + 3] = (byte) value;
        }
    }

    private static void write64(NtsDataView view, double byteOffset, long value, boolean little) {
        int at = at(view, byteOffset, 8);
        byte[] bytes = view.buffer.bytes;
        if (little) {
            for (int i = 0; i < 8; i++) { bytes[at + i] = (byte) (value >>> (8 * i)); }
        } else {
            for (int i = 0; i < 8; i++) { bytes[at + i] = (byte) (value >>> (56 - 8 * i)); }
        }
    }

    public static double getInt8(NtsDataView view, double byteOffset) {
        return view.buffer.bytes[at(view, byteOffset, 1)];
    }

    public static double getUint8(NtsDataView view, double byteOffset) {
        return view.buffer.bytes[at(view, byteOffset, 1)] & 0xFF;
    }

    public static void setInt8(NtsDataView view, double byteOffset, double value) {
        view.buffer.bytes[at(view, byteOffset, 1)] = (byte) NtsRuntime.toInt32(value);
    }

    public static void setUint8(NtsDataView view, double byteOffset, double value) {
        view.buffer.bytes[at(view, byteOffset, 1)] = (byte) NtsRuntime.toInt32(value);
    }

    public static double getInt16(NtsDataView view, double byteOffset, boolean little) {
        return (short) read16(view, byteOffset, little);
    }

    public static double getUint16(NtsDataView view, double byteOffset, boolean little) {
        return read16(view, byteOffset, little) & 0xFFFF;
    }

    public static void setInt16(NtsDataView view, double byteOffset, double value, boolean little) {
        write16(view, byteOffset, NtsRuntime.toInt32(value), little);
    }

    public static void setUint16(NtsDataView view, double byteOffset, double value, boolean little) {
        write16(view, byteOffset, NtsRuntime.toInt32(value), little);
    }

    public static double getInt32(NtsDataView view, double byteOffset, boolean little) {
        return read32(view, byteOffset, little);
    }

    /**
     * Unsigned, so the result does not fit an `int` and the `& 0xFFFFFFFFL` is
     * the whole of the difference from the signed accessor.
     */
    public static double getUint32(NtsDataView view, double byteOffset, boolean little) {
        return read32(view, byteOffset, little) & 0xFFFFFFFFL;
    }

    public static void setInt32(NtsDataView view, double byteOffset, double value, boolean little) {
        write32(view, byteOffset, NtsRuntime.toInt32(value), little);
    }

    public static void setUint32(NtsDataView view, double byteOffset, double value, boolean little) {
        write32(view, byteOffset, NtsRuntime.toInt32(value), little);
    }

    /** `intBitsToFloat` is exact on every pattern; the widening to double is JS's. */
    public static double getFloat32(NtsDataView view, double byteOffset, boolean little) {
        return Float.intBitsToFloat(read32(view, byteOffset, little));
    }

    /** `floatToRawIntBits`, so a signalling NaN keeps its payload. */
    public static void setFloat32(NtsDataView view, double byteOffset, double value, boolean little) {
        write32(view, byteOffset, Float.floatToRawIntBits((float) value), little);
    }

    public static double getFloat64(NtsDataView view, double byteOffset, boolean little) {
        return Double.longBitsToDouble(read64(view, byteOffset, little));
    }

    public static void setFloat64(NtsDataView view, double byteOffset, double value, boolean little) {
        write64(view, byteOffset, Double.doubleToRawLongBits(value), little);
    }

    public static NtsBigInt getBigInt64(NtsDataView view, double byteOffset, boolean little) {
        return NtsBigInt.fromLong(read64(view, byteOffset, little));
    }

    /** Unsigned: the same 64 bits with a zero high word rather than a sign. */
    public static NtsBigInt getBigUint64(NtsDataView view, double byteOffset, boolean little) {
        return NtsBigInt.of(0L, read64(view, byteOffset, little));
    }

    public static void setBigInt64(NtsDataView view, double byteOffset, NtsBigInt value, boolean little) {
        write64(view, byteOffset, value.lo, little);
    }

    public static void setBigUint64(NtsDataView view, double byteOffset, NtsBigInt value, boolean little) {
        write64(view, byteOffset, value.lo, little);
    }

    /** `ToIndex`, shared with the buffer so the two cannot disagree. */
    private static int index(double value, String what) {
        return NtsBuffer.toIndex(value, what);
    }
}
