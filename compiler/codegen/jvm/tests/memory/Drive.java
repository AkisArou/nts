import nts.rt.NtsBigInt;
import nts.rt.NtsBuffer;
import nts.rt.NtsDataView;
import nts.rt.NtsView;
import nts.rt.NtsViewF32;
import nts.rt.NtsViewF64;
import nts.rt.NtsViewI16;
import nts.rt.NtsViewI32;
import nts.rt.NtsViewI64;
import nts.rt.NtsViewI8;
import nts.rt.NtsViewU64;
import nts.rt.NtsViewU16;
import nts.rt.NtsViewU32;
import nts.rt.NtsViewU8;
import nts.rt.NtsViewU8C;

/**
 * The same lines the node oracle prints, from this runtime. Compared as text,
 * where every float is a bit pattern rather than a rendering.
 */
public final class Drive {
    static final StringBuilder OUT = new StringBuilder();

    static void line(String s) { OUT.append(s).append('\n'); }

    static String bits(double x) {
        return pad(Long.toHexString(Double.doubleToRawLongBits(x)), 16);
    }

    static String pad(String s, int width) {
        StringBuilder b = new StringBuilder();
        for (int i = s.length(); i < width; i++) { b.append('0'); }
        return b.append(s).toString();
    }

    /** Both words: the high one is the whole difference between the two views. */
    static String big128(nts.rt.NtsBigInt v) {
        return pad(Long.toHexString(v.hi), 16) + ":" + pad(Long.toHexString(v.lo), 16);
    }

    static String hex(NtsBuffer buffer) {
        byte[] bytes = NtsBuffer.storage(buffer);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < (int) NtsBuffer.byteLength(buffer); i++) {
            b.append(pad(Integer.toHexString(bytes[i] & 0xFF), 2));
        }
        return b.toString();
    }

    static final int[] PATTERN = {
        0x00, 0xff, 0x80, 0x7f, 0x7f, 0xc0, 0x00, 0x01,
        0xff, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x7f, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    };

    static final double[] NUMBERS = {
        0, -0.0, 1, -1, 0.5, -0.5, 127, 128, 255, 256, 32767, 32768, 65535, 65536,
        2147483647.0, 2147483648.0, 4294967295.0, 4294967296.0, -2147483648.0, -2147483649.0,
        1e21, -1e21, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NaN,
        1.5e-45, 3.4028235e38, 5e-324, 1.7976931348623157e308,
    };

    static final long[] BIGS = {
        0L, 1L, -1L, 0x7fffffffffffffffL, 0x8000000000000000L, 0xdeadbeefcafebabeL,
    };

    static double read(String name, NtsDataView v, int o, boolean le) {
        if (name.equals("i8")) { return NtsDataView.getInt8(v, o); }
        if (name.equals("u8")) { return NtsDataView.getUint8(v, o); }
        if (name.equals("i16")) { return NtsDataView.getInt16(v, o, le); }
        if (name.equals("u16")) { return NtsDataView.getUint16(v, o, le); }
        if (name.equals("i32")) { return NtsDataView.getInt32(v, o, le); }
        if (name.equals("u32")) { return NtsDataView.getUint32(v, o, le); }
        if (name.equals("f32")) { return NtsDataView.getFloat32(v, o, le); }
        return NtsDataView.getFloat64(v, o, le);
    }

    static void write(String name, NtsDataView v, int o, double x, boolean le) {
        if (name.equals("i8")) { NtsDataView.setInt8(v, o, x); return; }
        if (name.equals("u8")) { NtsDataView.setUint8(v, o, x); return; }
        if (name.equals("i16")) { NtsDataView.setInt16(v, o, x, le); return; }
        if (name.equals("u16")) { NtsDataView.setUint16(v, o, x, le); return; }
        if (name.equals("i32")) { NtsDataView.setInt32(v, o, x, le); return; }
        if (name.equals("u32")) { NtsDataView.setUint32(v, o, x, le); return; }
        if (name.equals("f32")) { NtsDataView.setFloat32(v, o, x, le); return; }
        NtsDataView.setFloat64(v, o, x, le);
    }

    static final String[] READS = { "i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64" };
    static final int[] READ_WIDTH = { 1, 1, 2, 2, 4, 4, 4, 8 };

    public static void main(String[] args) {
        NtsBuffer source = NtsBuffer.allocate(PATTERN.length);
        byte[] into = NtsBuffer.storage(source);
        for (int i = 0; i < PATTERN.length; i++) { into[i] = (byte) PATTERN[i]; }
        NtsDataView view = NtsDataView.over(source, 0);

        for (int k = 0; k < READS.length; k++) {
            int width = READ_WIDTH[k];
            for (int o = 0; o + width <= PATTERN.length; o++) {
                for (int e = 0; e < 2; e++) {
                    boolean le = e == 1;
                    line("get " + READS[k] + " " + o + " " + (le ? "le" : "be")
                        + " " + bits(read(READS[k], view, o, le)));
                }
            }
        }
        for (int b = 0; b < 2; b++) {
            String name = b == 0 ? "bi64" : "bu64";
            for (int o = 0; o + 8 <= PATTERN.length; o++) {
                for (int e = 0; e < 2; e++) {
                    boolean le = e == 1;
                    NtsBigInt got = b == 0
                        ? NtsDataView.getBigInt64(view, o, le)
                        : NtsDataView.getBigUint64(view, o, le);
                    line("get " + name + " " + o + " " + (le ? "le" : "be")
                        + " " + pad(Long.toHexString(got.lo), 16));
                }
            }
        }

        int[] offsets = { 0, 1, 3, 7 };
        for (int k = 0; k < READS.length; k++) {
            int width = READ_WIDTH[k];
            for (double x : NUMBERS) {
                for (int o : offsets) {
                    if (o + width > 16) { continue; }
                    for (int e = 0; e < 2; e++) {
                        boolean le = e == 1;
                        NtsBuffer scratch = NtsBuffer.allocate(16);
                        java.util.Arrays.fill(NtsBuffer.storage(scratch), (byte) 0xa5);
                        write(READS[k], NtsDataView.over(scratch, 0), o, x, le);
                        line("set " + READS[k] + " " + o + " " + (le ? "le" : "be")
                            + " " + bits(x) + " " + hex(scratch));
                    }
                }
            }
        }
        int[] bigOffsets = { 0, 1, 7 };
        for (int b = 0; b < 2; b++) {
            String name = b == 0 ? "bi64" : "bu64";
            for (long x : BIGS) {
                for (int o : bigOffsets) {
                    for (int e = 0; e < 2; e++) {
                        boolean le = e == 1;
                        NtsBuffer scratch = NtsBuffer.allocate(16);
                        java.util.Arrays.fill(NtsBuffer.storage(scratch), (byte) 0xa5);
                        NtsDataView dv = NtsDataView.over(scratch, 0);
                        NtsBigInt value = NtsBigInt.fromLong(x);
                        if (b == 0) { NtsDataView.setBigInt64(dv, o, value, le); }
                        else { NtsDataView.setBigUint64(dv, o, value, le); }
                        line("set " + name + " " + o + " " + (le ? "le" : "be")
                            + " " + pad(Long.toHexString(x), 16) + " " + hex(scratch));
                    }
                }
            }
        }

        // See vectors.mjs: the only vector that can tell the raw bit accessors
        // from the canonicalising ones, because it is the only one whose value
        // has a NaN payload before it reaches a setter.
        String[] trips = { "f32", "f64" };
        int[] tripWidth = { 4, 8 };
        for (int k = 0; k < trips.length; k++) {
            for (int o = 0; o + tripWidth[k] <= PATTERN.length; o++) {
                for (int e = 0; e < 2; e++) {
                    boolean le = e == 1;
                    NtsBuffer scratch = NtsBuffer.allocate(16);
                    java.util.Arrays.fill(NtsBuffer.storage(scratch), (byte) 0xa5);
                    write(trips[k], NtsDataView.over(scratch, 0), 0, read(trips[k], view, o, le), le);
                    line("trip " + trips[k] + " " + o + " " + (le ? "le" : "be") + " " + hex(scratch));
                }
            }
        }

        NtsBuffer b8 = NtsBuffer.allocate(8);
        byte[] eight = NtsBuffer.storage(b8);
        for (int i = 0; i < 8; i++) { eight[i] = (byte) (i + 1); }
        double[][] cuts = { {0, 8}, {2, 5}, {-3, -1}, {5, 2}, {0, 100}, {-100, 100}, {3, 3} };
        for (double[] cut : cuts) {
            line("slice " + text(cut[0]) + " " + text(cut[1]) + " "
                + hex(NtsBuffer.slice(b8, cut[0], cut[1])));
        }
        line("byteLength " + (int) NtsBuffer.byteLength(b8));
        line("resizable " + NtsBuffer.resizable(b8));
        line("maxByteLength " + (int) NtsBuffer.maxByteLength(b8));

        NtsBuffer r = NtsBuffer.allocateResizable(4, 12);
        byte[] four = NtsBuffer.storage(r);
        four[0] = 9; four[1] = 8; four[2] = 7; four[3] = 6;
        line("grow-before " + (int) NtsBuffer.byteLength(r) + " " + hex(r));
        NtsBuffer.resize(r, 8);
        line("grow-after " + (int) NtsBuffer.byteLength(r) + " " + hex(r));
        NtsBuffer.resize(r, 2);
        line("shrink " + (int) NtsBuffer.byteLength(r) + " " + hex(r));
        NtsBuffer.resize(r, 6);
        line("regrow " + (int) NtsBuffer.byteLength(r) + " " + hex(r));
        line("resizable " + NtsBuffer.resizable(r) + " " + (int) NtsBuffer.maxByteLength(r));

        NtsBuffer t = NtsBuffer.allocate(4);
        byte[] ts = NtsBuffer.storage(t);
        ts[0] = 1; ts[1] = 2; ts[2] = 3; ts[3] = 4;
        NtsBuffer moved = NtsBuffer.transfer(t, NtsBuffer.byteLength(t), false);
        line("transfer " + NtsBuffer.detached(t) + " " + (int) NtsBuffer.byteLength(t)
            + " " + (int) NtsBuffer.byteLength(moved) + " " + hex(moved));
        NtsBuffer grown = NtsBuffer.transfer(moved, 6, false);
        line("transfer-grow " + NtsBuffer.detached(moved) + " "
            + (int) NtsBuffer.byteLength(grown) + " " + hex(grown));
        NtsBuffer cut = NtsBuffer.transfer(grown, 2, false);
        line("transfer-shrink " + NtsBuffer.detached(grown) + " "
            + (int) NtsBuffer.byteLength(cut) + " " + hex(cut));
        NtsBuffer kept = NtsBuffer.transfer(NtsBuffer.allocateResizable(4, 16), 4, false);
        line("transfer-keeps-resizable " + NtsBuffer.resizable(kept) + " "
            + (int) NtsBuffer.maxByteLength(kept));
        NtsBuffer fixed = NtsBuffer.transfer(NtsBuffer.allocateResizable(4, 16), 4, true);
        line("transfer-to-fixed " + NtsBuffer.resizable(fixed) + " "
            + (int) NtsBuffer.byteLength(fixed));

        views();
        bulk();
        refusals();
        System.out.print(OUT);
    }

    static final String[] VIEWS = { "i8", "u8", "u8c", "i16", "u16", "i32", "u32", "f32", "f64" };
    static final int[] WIDTH = { 1, 1, 1, 2, 2, 4, 4, 4, 8 };

    static final double[] ELEMENTS = {
        0, -0.0, 1, -1, 0.5, -0.5, 1.5, 2.5, 3.5, -1.5, -2.5, 127, 127.5, 128, 255, 255.5, 256,
        -128, -129, 32767, 32768, 65535, 65536, 2147483647.0, 2147483648.0, 4294967295.0,
        4294967296.0, -2147483648.0, -2147483649.0, 1e21, -1e21,
        Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NaN,
        0.1, 1.1, 16777217.0, 3.4028235e38, 3.4028236e38, 5e-324, 1.7976931348623157e308,
    };

    /** One dispatch, so the nine element types are a table rather than nine copies. */
    static NtsView make(String kind, NtsBuffer buffer, double offset) {
        if (kind.equals("i8")) { return NtsViewI8.over(buffer, offset); }
        if (kind.equals("u8")) { return NtsViewU8.over(buffer, offset); }
        if (kind.equals("u8c")) { return NtsViewU8C.over(buffer, offset); }
        if (kind.equals("i16")) { return NtsViewI16.over(buffer, offset); }
        if (kind.equals("u16")) { return NtsViewU16.over(buffer, offset); }
        if (kind.equals("i32")) { return NtsViewI32.over(buffer, offset); }
        if (kind.equals("u32")) { return NtsViewU32.over(buffer, offset); }
        if (kind.equals("f32")) { return NtsViewF32.over(buffer, offset); }
        return NtsViewF64.over(buffer, offset);
    }

    static void put(NtsView view, double index, double value) {
        if (view instanceof NtsViewI8) { NtsViewI8.set((NtsViewI8) view, index, value); }
        else if (view instanceof NtsViewU8C) { NtsViewU8C.set((NtsViewU8C) view, index, value); }
        else if (view instanceof NtsViewU8) { NtsViewU8.set((NtsViewU8) view, index, value); }
        else if (view instanceof NtsViewI16) { NtsViewI16.set((NtsViewI16) view, index, value); }
        else if (view instanceof NtsViewU16) { NtsViewU16.set((NtsViewU16) view, index, value); }
        else if (view instanceof NtsViewI32) { NtsViewI32.set((NtsViewI32) view, index, value); }
        else if (view instanceof NtsViewU32) { NtsViewU32.set((NtsViewU32) view, index, value); }
        else if (view instanceof NtsViewF32) { NtsViewF32.set((NtsViewF32) view, index, value); }
        else { NtsViewF64.set((NtsViewF64) view, index, value); }
    }

    static double got(NtsView view, double index) {
        if (view instanceof NtsViewI8) { return NtsViewI8.get((NtsViewI8) view, index); }
        if (view instanceof NtsViewU8C) { return NtsViewU8C.get((NtsViewU8C) view, index); }
        if (view instanceof NtsViewU8) { return NtsViewU8.get((NtsViewU8) view, index); }
        if (view instanceof NtsViewI16) { return NtsViewI16.get((NtsViewI16) view, index); }
        if (view instanceof NtsViewU16) { return NtsViewU16.get((NtsViewU16) view, index); }
        if (view instanceof NtsViewI32) { return NtsViewI32.get((NtsViewI32) view, index); }
        if (view instanceof NtsViewU32) { return NtsViewU32.get((NtsViewU32) view, index); }
        if (view instanceof NtsViewF32) { return NtsViewF32.get((NtsViewF32) view, index); }
        return NtsViewF64.get((NtsViewF64) view, index);
    }

    static void views() {
        for (int k = 0; k < VIEWS.length; k++) {
            for (double x : ELEMENTS) {
                NtsBuffer backing = NtsBuffer.allocate(WIDTH[k] * 3);
                java.util.Arrays.fill(NtsBuffer.storage(backing), (byte) 0xa5);
                NtsView view = make(VIEWS[k], backing, 0);
                put(view, 1, x);
                line("view " + VIEWS[k] + " " + bits(x) + " " + hex(backing) + " "
                    + bits(got(view, 1)));
            }
        }
        for (int k = 0; k < VIEWS.length; k++) {
            NtsBuffer backing = NtsBuffer.allocate(32);
            byte[] into = NtsBuffer.storage(backing);
            for (int i = 0; i < PATTERN.length; i++) { into[i] = (byte) PATTERN[i]; }
            NtsView view = make(VIEWS[k], backing, 0);
            StringBuilder seen = new StringBuilder();
            for (int i = 0; i < (int) NtsView.length(view); i++) {
                if (i > 0) { seen.append(','); }
                seen.append(bits(got(view, i)));
            }
            line("read " + VIEWS[k] + " " + seen);
        }

        String[] bigViews = { "bi64", "bu64" };
        long[] bigElements = {
            0L, 1L, -1L, 2L, -2L, 0x7fffffffffffffffL, 0x8000000000000000L,
            0xdeadbeefcafebabeL, 0x0102030405060708L, -0x0102030405060708L,
        };
        for (String kind : bigViews) {
            for (long x : bigElements) {
                NtsBuffer backing = NtsBuffer.allocate(24);
                java.util.Arrays.fill(NtsBuffer.storage(backing), (byte) 0xa5);
                NtsBigInt value = NtsBigInt.fromLong(x);
                String back;
                if (kind.equals("bi64")) {
                    NtsViewI64 view = NtsViewI64.over(backing, 0);
                    NtsViewI64.set(view, 1, value);
                    back = big128(NtsViewI64.get(view, 1));
                } else {
                    NtsViewU64 view = NtsViewU64.over(backing, 0);
                    NtsViewU64.set(view, 1, value);
                    back = big128(NtsViewU64.get(view, 1));
                }
                line("bigview " + kind + " " + pad(Long.toHexString(x), 16) + " "
                    + hex(backing) + " " + back);
            }
        }
        for (String kind : bigViews) {
            NtsBuffer backing = NtsBuffer.allocate(32);
            byte[] into = NtsBuffer.storage(backing);
            for (int i = 0; i < PATTERN.length; i++) { into[i] = (byte) PATTERN[i]; }
            StringBuilder seen = new StringBuilder();
            if (kind.equals("bi64")) {
                NtsViewI64 view = NtsViewI64.over(backing, 0);
                for (int i = 0; i < (int) NtsView.length(view); i++) {
                    if (i > 0) { seen.append(','); }
                    seen.append(big128(NtsViewI64.get(view, i)));
                }
            } else {
                NtsViewU64 view = NtsViewU64.over(backing, 0);
                for (int i = 0; i < (int) NtsView.length(view); i++) {
                    if (i > 0) { seen.append(','); }
                    seen.append(big128(NtsViewU64.get(view, i)));
                }
            }
            line("bigread " + kind + " " + seen);
        }
        {
            NtsBuffer backing = NtsBuffer.allocate(32);
            byte[] into = NtsBuffer.storage(backing);
            for (int i = 0; i < PATTERN.length; i++) { into[i] = (byte) PATTERN[i]; }
            NtsViewI64 whole = NtsViewI64.over(backing, 0);
            NtsViewI64 part = NtsViewI64.part(backing, 8, 2);
            line("bigshape " + (int) NtsView.length(whole) + " " + (int) NtsView.byteOffset(whole)
                + " " + (int) NtsView.byteLength(whole));
            line("bigshape " + (int) NtsView.length(part) + " " + (int) NtsView.byteOffset(part)
                + " " + (int) NtsView.byteLength(part));
            NtsViewI64 sub = NtsViewI64.subarray(part, 1, 2);
            line("bigsub " + (int) NtsView.length(sub) + " " + (int) NtsView.byteOffset(sub));
            NtsViewI64 cut = NtsViewI64.slice(part, 0, 2);
            line("bigslice " + (int) NtsView.length(cut) + " "
                + (int) NtsBuffer.byteLength(NtsView.buffer(cut)) + " " + hex(NtsView.buffer(cut)));
            NtsBuffer r = NtsBuffer.allocateResizable(24, 40);
            NtsViewU64 tracking = NtsViewU64.over(r, 0);
            line("bigtrack " + (int) NtsView.length(tracking));
            NtsBuffer.resize(r, 12);
            line("bigtrack-odd " + (int) NtsView.length(tracking));
        }

        for (int k = 0; k < VIEWS.length; k++) {
            NtsBuffer from = NtsBuffer.allocate(32);
            byte[] source = NtsBuffer.storage(from);
            for (int i = 0; i < PATTERN.length; i++) { source[i] = (byte) PATTERN[i]; }
            NtsView reading = make(VIEWS[k], from, 0);
            NtsBuffer into = NtsBuffer.allocate(32);
            java.util.Arrays.fill(NtsBuffer.storage(into), (byte) 0xa5);
            NtsView writing = make(VIEWS[k], into, 0);
            for (int i = 0; i < (int) NtsView.length(reading); i++) {
                put(writing, i, got(reading, i));
            }
            line("trip-view " + VIEWS[k] + " " + hex(into));
        }

        NtsBuffer backing = NtsBuffer.allocate(16);
        byte[] sixteen = NtsBuffer.storage(backing);
        for (int i = 0; i < 16; i++) { sixteen[i] = (byte) (i + 1); }
        NtsViewU8 whole = NtsViewU8.over(backing, 0);
        NtsViewU8 part = NtsViewU8.part(backing, 4, 8);
        line("shape " + (int) NtsView.length(whole) + " " + (int) NtsView.byteOffset(whole)
            + " " + (int) NtsView.byteLength(whole));
        line("shape " + (int) NtsView.length(part) + " " + (int) NtsView.byteOffset(part)
            + " " + (int) NtsView.byteLength(part));
        NtsViewU8 sub = NtsViewU8.subarray(part, 2, 6);
        line("subarray " + (int) NtsView.length(sub) + " " + (int) NtsView.byteOffset(sub)
            + " " + window(sub));
        NtsViewU8 cut = NtsViewU8.slice(part, 2, 6);
        line("slice " + (int) NtsView.length(cut) + " " + (int) NtsView.byteOffset(cut) + " "
            + (int) NtsBuffer.byteLength(NtsView.buffer(cut)) + " " + hex(NtsView.buffer(cut)));
        NtsViewU8.set(cut, 0, 99);
        line("slice-copies " + hex(backing));
        NtsViewU8 filled = NtsViewU8.part(backing, 0, 8);
        NtsViewU8.fill(filled, 7, 2, 5);
        line("fill " + hex(backing));
        NtsViewU32 u32 = NtsViewU32.over(backing, 8);
        line("aligned " + (int) NtsView.length(u32) + " " + (int) NtsView.byteOffset(u32));

        NtsBuffer r = NtsBuffer.allocateResizable(16, 32);
        NtsViewU16 tracking = NtsViewU16.over(r, 0);
        NtsViewU16 fixed = NtsViewU16.part(r, 0, 4);
        line("track " + (int) NtsView.length(tracking) + " " + (int) NtsView.length(fixed));
        NtsBuffer.resize(r, 8);
        line("track-shrunk " + (int) NtsView.length(tracking));
        NtsBuffer.resize(r, 24);
        line("track-grown " + (int) NtsView.length(tracking));
        NtsBuffer.resize(r, 9);
        line("track-odd " + (int) NtsView.length(tracking));
    }

    /** The bytes a view spans, which is not the whole buffer. */
    static String window(NtsView view) {
        byte[] bytes = NtsBuffer.storage(NtsView.buffer(view));
        StringBuilder b = new StringBuilder();
        int from = (int) NtsView.byteOffset(view);
        for (int i = 0; i < (int) NtsView.byteLength(view); i++) {
            b.append(pad(Integer.toHexString(bytes[from + i] & 0xFF), 2));
        }
        return b.toString();
    }

    static final int[][] MOVES = {
        {2, 0, 5}, {0, 2, 8}, {3, 3, 3}, {1, 0, 7}, {-3, -6, -1}, {0, 0, 8}, {6, 0, 4},
    };

    static void bulk() {
        for (int[] move : MOVES) {
            NtsBuffer b = NtsBuffer.allocate(8);
            byte[] bytes = NtsBuffer.storage(b);
            for (int i = 0; i < 8; i++) { bytes[i] = (byte) (i + 1); }
            NtsViewU8 v = NtsViewU8.over(b, 0);
            NtsView.copyWithin(v, move[0], move[1], move[2]);
            line("copywithin " + move[0] + " " + move[1] + " " + move[2] + " " + hex(b));
        }
        for (int[] move : MOVES) {
            NtsBuffer b = NtsBuffer.allocate(16);
            NtsViewU16 v = NtsViewU16.over(b, 0);
            for (int i = 0; i < 8; i++) { NtsViewU16.set(v, i, (i + 1) * 0x0101); }
            NtsView.copyWithin(v, move[0], move[1], move[2]);
            line("copywithin16 " + move[0] + " " + move[1] + " " + move[2] + " " + hex(b));
        }

        NtsBuffer source = NtsBuffer.allocate(8);
        byte[] src = NtsBuffer.storage(source);
        int[] pattern = { 1, 2, 3, 4, 250, 251, 252, 253 };
        for (int i = 0; i < 8; i++) { src[i] = (byte) pattern[i]; }
        for (int k = 0; k < VIEWS.length; k++) {
            if (VIEWS[k].equals("u8c")) { continue; }
            NtsBuffer into = NtsBuffer.allocate(72);
            java.util.Arrays.fill(NtsBuffer.storage(into), (byte) 0xa5);
            NtsView target = make(VIEWS[k], into, 0);
            NtsView.set(target, NtsViewU8.over(source, 0), 1);
            line("setinto " + VIEWS[k] + " " + hex(into));
        }
        for (int at = 0; at < 4; at++) {
            NtsBuffer shared = NtsBuffer.allocate(16);
            byte[] bytes = NtsBuffer.storage(shared);
            for (int i = 0; i < 16; i++) { bytes[i] = (byte) (i + 1); }
            NtsViewU16 wide = NtsViewU16.over(shared, 0);
            NtsView.set(wide, NtsViewU16.part(shared, 0, 4), at);
            line("setshared " + at + " " + hex(shared));
        }
        final NtsBuffer into = NtsBuffer.allocate(8);
        final NtsViewU8 target = NtsViewU8.over(into, 0);
        attempt("setpast", new Attempt() {
            public void run() { NtsView.set(target, NtsViewU8.of(3), 6); }
        });
        attempt("setfits", new Attempt() {
            public void run() { NtsView.set(target, NtsViewU8.of(3), 5); }
        });

        NtsBuffer big = NtsBuffer.allocate(32);
        NtsViewI64 bv = NtsViewI64.over(big, 0);
        for (int i = 0; i < 4; i++) { NtsViewI64.set(bv, i, NtsBigInt.fromLong(i + 1)); }
        NtsView.copyWithin(bv, 1, 0, 3);
        line("bigcopywithin " + hex(big));
        NtsBuffer target64 = NtsBuffer.allocate(32);
        NtsViewU64 tv = NtsViewU64.over(target64, 0);
        NtsViewU64 from = NtsViewU64.of(3);
        NtsViewU64.set(from, 0, NtsBigInt.fromLong(9));
        NtsViewU64.set(from, 1, NtsBigInt.fromLong(8));
        NtsViewU64.set(from, 2, NtsBigInt.fromLong(7));
        NtsViewU64.set(tv, from, 1);
        line("bigset " + hex(target64));
    }

    interface Attempt { void run(); }

    /**
     * The fact, not the message -- and a **refusal is not the same fact as any
     * throw**, which this got wrong first time round.
     *
     * <p>Catching `RuntimeException | Error` and calling all of it "refuses"
     * made the bounds check untestable: with the check deleted, the access runs
     * off the end of the `byte[]`, the JVM raises
     * `ArrayIndexOutOfBoundsException`, the catch-all reports `refuses`, and
     * the suite stays green while every bound in the file is gone. The
     * sabotage found it.
     *
     * <p>It is also the distinction the whole harness rests on. An `nts:`
     * refusal is a *declined* case; anything else is a **defect**, on a case
     * every other lane declines cleanly. So the two are printed differently,
     * with the class name, and node's `refuses` can only be matched by an
     * actual refusal.
     */
    static void attempt(String label, Attempt body) {
        try { body.run(); line("allows " + label); }
        catch (nts.rt.NtsRefusal refusal) { line("refuses " + label); }
        catch (RuntimeException | Error escaped) {
            line("escapes " + label + " " + escaped.getClass().getSimpleName());
        }
    }

    static void refusals() {
        final NtsBuffer b = NtsBuffer.allocate(8);
        final NtsDataView v = NtsDataView.over(b, 0);
        attempt("read-past-end", new Attempt() { public void run() { NtsDataView.getFloat64(v, 1, false); } });
        attempt("read-at-end", new Attempt() { public void run() { NtsDataView.getInt8(v, 8); } });
        attempt("read-negative", new Attempt() { public void run() { NtsDataView.getInt8(v, -1); } });
        attempt("read-fractional", new Attempt() { public void run() { NtsDataView.getInt8(v, 0.5); } });
        attempt("read-nan-offset", new Attempt() { public void run() { NtsDataView.getInt8(v, Double.NaN); } });
        attempt("read-huge-offset", new Attempt() { public void run() { NtsDataView.getInt8(v, 1e20); } });
        attempt("read-fractional-past-end", new Attempt() { public void run() { NtsDataView.getFloat64(v, 1.5, false); } });
        attempt("read-negative-fraction", new Attempt() { public void run() { NtsDataView.getInt8(v, -0.5); } });
        attempt("read-infinite", new Attempt() { public void run() { NtsDataView.getInt8(v, Double.POSITIVE_INFINITY); } });
        attempt("read-2-53", new Attempt() { public void run() { NtsDataView.getInt8(v, 9007199254740991.0); } });
        attempt("read-2-53-plus", new Attempt() { public void run() { NtsDataView.getInt8(v, 9007199254740992.0); } });
        attempt("read-last", new Attempt() { public void run() { NtsDataView.getInt8(v, 7); } });
        attempt("read-last-f64", new Attempt() { public void run() { NtsDataView.getFloat64(v, 0, false); } });
        attempt("write-past-end", new Attempt() { public void run() { NtsDataView.setInt32(v, 6, 1, false); } });
        attempt("view-past-end", new Attempt() { public void run() { NtsDataView.over(b, 9); } });
        attempt("view-at-end", new Attempt() { public void run() { NtsDataView.over(b, 8); } });
        attempt("view-length-past-end", new Attempt() { public void run() { NtsDataView.part(b, 4, 8); } });
        attempt("view-negative-offset", new Attempt() { public void run() { NtsDataView.over(b, -1); } });
        attempt("view-fractional-offset", new Attempt() { public void run() { NtsDataView.over(b, 0.5); } });
        attempt("view-nan-offset", new Attempt() { public void run() { NtsDataView.over(b, Double.NaN); } });
        attempt("view-fractional-length", new Attempt() { public void run() { NtsDataView.part(b, 0, 8.5); } });

        final NtsBuffer gone = NtsBuffer.allocate(8);
        final NtsDataView stale = NtsDataView.over(gone, 0);
        NtsBuffer.transfer(gone, NtsBuffer.byteLength(gone), false);
        attempt("read-detached", new Attempt() { public void run() { NtsDataView.getInt8(stale, 0); } });
        attempt("write-detached", new Attempt() { public void run() { NtsDataView.setInt8(stale, 0, 1); } });
        attempt("length-detached", new Attempt() { public void run() { NtsDataView.byteLength(stale); } });
        attempt("slice-detached", new Attempt() { public void run() { NtsBuffer.slice(gone, 0, 1); } });
        attempt("view-over-detached", new Attempt() { public void run() { NtsDataView.over(gone, 0); } });

        final NtsBuffer fixed = NtsBuffer.allocate(8);
        attempt("resize-fixed", new Attempt() { public void run() { NtsBuffer.resize(fixed, 4); } });
        final NtsBuffer r = NtsBuffer.allocateResizable(8, 16);
        attempt("resize-in-range", new Attempt() { public void run() { NtsBuffer.resize(r, 12); } });
        attempt("resize-past-max", new Attempt() { public void run() { NtsBuffer.resize(r, 20); } });
        attempt("resize-negative", new Attempt() { public void run() { NtsBuffer.resize(r, -1); } });
        attempt("construct-past-max", new Attempt() { public void run() { NtsBuffer.allocateResizable(20, 16); } });
        attempt("construct-fractional", new Attempt() { public void run() { NtsBuffer.allocate(4.5); } });
        attempt("construct-nan", new Attempt() { public void run() { NtsBuffer.allocate(Double.NaN); } });
        attempt("construct-negative-fraction", new Attempt() { public void run() { NtsBuffer.allocate(-0.5); } });
        attempt("resize-fractional", new Attempt() { public void run() { NtsBuffer.resize(r, 4.5); } });
        line("resize-fractional-length " + (int) NtsBuffer.byteLength(r));

        final NtsBuffer shrinking = NtsBuffer.allocateResizable(16, 16);
        final NtsDataView tracking = NtsDataView.over(shrinking, 0);
        attempt("shrink-before", new Attempt() { public void run() { NtsDataView.getFloat64(tracking, 8, false); } });
        NtsBuffer.resize(shrinking, 8);
        attempt("shrink-after", new Attempt() { public void run() { NtsDataView.getFloat64(tracking, 8, false); } });
        line("shrink-length " + (int) NtsDataView.byteLength(tracking));
        NtsBuffer.resize(shrinking, 16);
        attempt("regrow-after", new Attempt() { public void run() { NtsDataView.getFloat64(tracking, 8, false); } });
    }

    /** node prints `-3`, not `-3.0`; these are all integers. */
    static String text(double x) { return String.valueOf((long) x); }
}
