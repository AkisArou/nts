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
}
