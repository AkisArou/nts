package nts.rt;

/** Immutable erased value. Tag numbers and field descriptors are compiler ABI. */
public final class NtsValue {
    public static final int UNDEFINED = 0;
    public static final int BOOLEAN = 1;
    public static final int NUMBER = 2;
    public static final int STRING = 3;
    public static final int FUNCTION = 4;
    public static final int OBJECT = 5;
    public static final int NULL = 6;
    public final int tag;
    public final double num;
    public final Object ref;

    private NtsValue(int tag, double num, Object ref) {
        this.tag = tag;
        this.num = num;
        this.ref = ref;
    }

    public static final NtsValue UNDEFINED_VALUE = new NtsValue(UNDEFINED, 0.0, null);
    public static final NtsValue NULL_VALUE = new NtsValue(NULL, 0.0, null);
    // Narrowing an absent numeric result must read NaN, not the ordinary zero payload.
    public static final NtsValue ABSENT_NUMBER = new NtsValue(UNDEFINED, Double.NaN, null);
    private static final NtsValue TRUE_VALUE = new NtsValue(BOOLEAN, 1.0, null);
    private static final NtsValue FALSE_VALUE = new NtsValue(BOOLEAN, 0.0, null);

    // Do not pool mutable wrappers or add a lookup to every numeric erasure.
    // The immutable allocation is available for scalar replacement when it does not escape.
    public static NtsValue ofNumber(double value) { return new NtsValue(NUMBER, value, null); }
    public static NtsValue ofBoolean(boolean value) { return value ? TRUE_VALUE : FALSE_VALUE; }
    public static NtsValue ofString(String value) {
        return value == null ? NULL_VALUE : new NtsValue(STRING, 0.0, value);
    }
    public static NtsValue ofTagged(int tag, Object value) {
        return value == null ? NULL_VALUE : new NtsValue(tag, 0.0, value);
    }
    public static NtsValue ofObject(Object value) {
        return value == null ? NULL_VALUE : new NtsValue(OBJECT, 0.0, value);
    }
    public static boolean asBoolean(NtsValue value) { return value.num != 0.0; }
    public static String tagName(int tag) {
        switch (tag) {
            case UNDEFINED: return "undefined";
            case BOOLEAN: return "boolean";
            case NUMBER: return "number";
            case STRING: return "string";
            case FUNCTION: return "function";
            default: return "object";
        }
    }
    public static boolean truthy(NtsValue value) {
        switch (value.tag) {
            case UNDEFINED:
            case NULL: return false;
            case BOOLEAN: return value.num != 0.0;
            case NUMBER: return value.num == value.num && value.num != 0.0;
            case STRING: return !((String) value.ref).isEmpty();
            default: return true;
        }
    }
    public static boolean strictEq(NtsValue left, NtsValue right) {
        if (left.tag != right.tag) { return false; }
        switch (left.tag) {
            case UNDEFINED:
            case NULL: return true;
            case BOOLEAN:
            case NUMBER: return left.num == right.num;
            case STRING: return java.util.Objects.equals(left.ref, right.ref);
            default: return left.ref == right.ref;
        }
    }
}
