package nts.rt;

/** Immutable erased value. Tag numbers and field descriptors are compiler ABI. */
public final class NtsValue {
    public static final int UNDEFINED = 0;
    public static final int BOOLEAN = 1;
    public static final int NUMBER = 2;
    public static final int STRING = 3;
    public static final int FUNCTION = 4;
    // Below OBJECT, because `typeof` answers "symbol" and the object test is the
    // range comparison `tag >= OBJECT`, which must not admit one.
    public static final int SYMBOL = 5;
    public static final int OBJECT = 6;
    public static final int NULL = 7;
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
    /**
     * `Array.isArray`, which is a question about the *value* rather than about
     * any static type.
     *
     * <p>Four things answer `true` and one that looks like it should does not.
     * A bare JVM array of any element type; a growable array, which is a
     * wrapper class chosen by storage width; and a tuple, which is a generated
     * struct that the language calls an Array. A **typed array** answers
     * `false` -- `Array.isArray(new Uint8Array(4))` is `false` in node, and
     * that was unanswerable until `ManagedType::View` gave a view a
     * representation of its own. The refusal this replaces named that as its
     * cause.
     *
     * <p>`getClass().isArray()` rather than a chain of `instanceof` against
     * every element type: one call, and it cannot go stale when an element type
     * is added.
     */
    public static boolean isArray(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        if (ref == null) {
            return false;
        }
        return ref.getClass().isArray()
            || ref instanceof NtsTuple
            || ref instanceof NtsArrayD
            || ref instanceof NtsArrayL
            || ref instanceof NtsArrayZ;
    }

    /** `instanceof ArrayBuffer`, which is one class here and one descriptor there. */
    public static boolean isBuffer(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsBuffer;
    }

    /**
     * `instanceof Promise`.
     *
     * <p>The C lane compares a descriptor pointer against `nts_desc_promise`
     * after checking the tag is a reference; here the reference check and the
     * identity check are the same instruction, because `instanceof` is false
     * for `null` and true for exactly one class. A promise is not subclassed on
     * this lane -- `NtsPromise` is what `nts_promise_new` returns and nothing
     * derives from it -- so there is no gap between "is a promise" and "is
     * exactly a promise" for this to fall into.
     */
    public static boolean isPromise(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsPromise;
    }

    /**
     * `instanceof Uint8Array`, and the eight others.
     *
     * <p>**One test here, two on the C lane, and the difference is the point.**
     * All nine typed arrays share one struct in `runtime/c`, so the descriptor
     * says *some* typed array and a `kind` field says which -- and reading that
     * field out of an object which has none is undefined behaviour that happens
     * to answer correctly, which record 0195 records as the one failure a
     * differential cannot tell from correctness.
     *
     * <p>There are nine classes here, so `instanceof` answers both questions at
     * once and there is no field to read out of the wrong object. That is not a
     * cleverness; it is what record 0182's measurement bought -- the classes
     * exist because a monomorphic accessor is 0.177 ns/element against 0.924
     * through one that switches on a kind, and this is the same fact showing up
     * as a safety property.
     *
     * <p>The kinds are `NTS_ELEMENT_*`, and 2 is `Uint8ClampedArray`, which this
     * runtime has a class for even though no lowering produces one yet. It
     * answers here rather than being left to fall through to `false`: a wrong
     * `false` for a value that *is* one would be the same silent lie the
     * descriptor-field read is.
     */
    public static boolean isViewKind(NtsValue value, double kind) {
        Object ref = value == null ? null : value.ref;
        if (ref == null) {
            return false;
        }
        switch ((int) kind) {
            case 0: return ref instanceof NtsViewI8;
            case 1: return ref instanceof NtsViewU8;
            case 2: return ref instanceof NtsViewU8C;
            case 3: return ref instanceof NtsViewI16;
            case 4: return ref instanceof NtsViewU16;
            case 5: return ref instanceof NtsViewI32;
            case 6: return ref instanceof NtsViewU32;
            case 7: return ref instanceof NtsViewF32;
            case 8: return ref instanceof NtsViewF64;
            // A kind this runtime has no class for cannot be any value it
            // holds. Answering `false` is right and answering anything else
            // would be a guess about a numbering that is not this lane's.
            default: return false;
        }
    }

    public static String tagName(int tag) {
        switch (tag) {
            case UNDEFINED: return "undefined";
            case BOOLEAN: return "boolean";
            case NUMBER: return "number";
            case STRING: return "string";
            case FUNCTION: return "function";
            case SYMBOL: return "symbol";
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
