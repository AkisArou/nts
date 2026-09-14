package nts.rt;

/** Element-independent operations; array storage stays primitive and specialized. */
final class NtsArrays {
    private NtsArrays() {}
    static final int MAX_ARRAY = Integer.MAX_VALUE - 8;

    static double toInteger(double x) {
        if (Double.isNaN(x)) { return 0.0; }
        return x < 0.0 ? Math.ceil(x) : Math.floor(x);
    }

    // For an int-sized container, d2i saturation has exactly the required bounds
    // behavior. Truncate BEFORE applying a relative offset: -0.5 becomes 0.
    static int clamp(double index, int length) {
        int at = (int) index;
        if (at < 0) { at += length; }
        return at < 0 ? 0 : Math.min(at, length);
    }

    static int offset(double index, int length) {
        int at = (int) index;
        if (at < 0) { at += length; }
        return at < 0 || at >= length ? -1 : at;
    }

    static int checkedLength(long wanted) {
        if (wanted < 0 || wanted > MAX_ARRAY) {
            throw new OutOfMemoryError("array capacity exhausted");
        }
        return (int) wanted;
    }

    static int growCapacity(int current, int wanted) {
        checkedLength(wanted);
        return (int) Math.min(MAX_ARRAY, Math.max((long) wanted, Math.max(4L, (long) current * 2)));
    }

    static int joinCapacity(int count, String separator, int average) {
        long size = (long) count * average + (long) Math.max(0, count - 1)
            * (separator == null ? 4 : separator.length());
        return (int) Math.max(16L, Math.min(65536L, size));
    }

    // --- a JavaScript number[] meeting a Java primitive array ----------------
    //
    // **Copied, and narrowed the way JavaScript narrows.** Our `number[]` is a
    // `double[]`; a Java method declaring `int...` wants `[I`, and the two are
    // unrelated types to the verifier however similar the values look. So the
    // elements move, and each one takes the same conversion a scalar would at
    // the same boundary -- `ToInt32`, wrapping, not `d2i`'s saturation.
    //
    // `long` and `float` are plain casts because neither has a JavaScript
    // narrowing to disagree with: a `number` that is not an integer is already
    // outside what a `long` parameter means, and `float` is the one width
    // where the JVM's own conversion is the specified one.

    /** A {@code double[]} as a Java {@code int[]}; see the note above. */
    public static int[] toI(double[] xs) {
        if (xs == null) { return new int[0]; }
        int[] out = new int[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (int) NtsRuntime.toInt32(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code long[]}; see the note above. */
    public static long[] toJ(double[] xs) {
        if (xs == null) { return new long[0]; }
        long[] out = new long[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (long) x; }
        return out;
    }

    /** A {@code double[]} as a Java {@code short[]}; see the note above. */
    public static short[] toS(double[] xs) {
        if (xs == null) { return new short[0]; }
        short[] out = new short[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (short) NtsRuntime.toInt32(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code byte[]}; see the note above. */
    public static byte[] toB(double[] xs) {
        if (xs == null) { return new byte[0]; }
        byte[] out = new byte[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (byte) NtsRuntime.toInt32(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code char[]}; see the note above. */
    public static char[] toC(double[] xs) {
        if (xs == null) { return new char[0]; }
        char[] out = new char[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (char) NtsRuntime.toUint16(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code float[]}; see the note above. */
    public static float[] toF(double[] xs) {
        if (xs == null) { return new float[0]; }
        float[] out = new float[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (float) x; }
        return out;
    }
}
