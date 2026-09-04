package nts.rt;

/**
 * A value carrying its own type, where the static type does not decide one.
 *
 * <p>Three fields mirroring the C runtime's {@code NtsValue} struct, and the
 * same tag numbering, because a tag and its spelling are one fact and this is
 * now the <b>third</b> place that fact is written: {@code hir::tags} in the
 * compiler, {@code NtsTag} in {@code nts_runtime.h}, and here. The compiler's
 * copy says of the second one that "that copy is unavoidable, since C cannot
 * read this one" -- and the same is true of Java. So the three are held equal
 * by a test rather than by a comment.
 *
 * <h2>Why a class and not three slots, for now</h2>
 *
 * <p>Decomposing an erased value into an {@code int}, a {@code double} and a
 * reference is very likely the faster representation, and locals are free on
 * the JVM in a way they are not in C. It is also a much larger change, and the
 * question it answers -- does C2 scalar-replace this object -- has a direct
 * measurement: {@code getThreadAllocatedBytes} around the timed loop of the four
 * {@code erasure-*} probes. Zero bytes per operation means it did.
 *
 * <p>So this ships first and the number decides what replaces it. Building the
 * larger change on the assumption would be the third time in one day that an
 * optimisation was written for a cost that turned out not to exist.
 *
 * <p>One fact is already known and argues for decomposition if the probes come
 * back non-zero: <b>JDK 21 has no {@code ReduceAllocationMerges}</b>, so an
 * object merged at a control-flow join is not scalar-replaced at all -- and a
 * {@code typeof} narrowing produces exactly that shape.
 */
public final class NtsValue {
    /**
     * The tags, in the order {@code hir::tags} fixes.
     *
     * <p>The order is load-bearing rather than arbitrary. {@code typeof x ===
     * "object"} is the single comparison {@code tag >= OBJECT}, which needs
     * {@code NULL} adjacent to {@code OBJECT} -- {@code typeof null} is
     * {@code "object"} -- and {@code FUNCTION} below them, because a closure
     * must fall outside that range.
     */
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

    /**
     * The two absences, interned.
     *
     * <p>They carry no payload, so every one is the same one -- and a compiled
     * program mentions {@code undefined} constantly, so allocating a fresh
     * object per mention would be a cost with no information in it.
     */
    public static final NtsValue UNDEFINED_VALUE = new NtsValue(UNDEFINED, 0.0, null);
    public static final NtsValue NULL_VALUE = new NtsValue(NULL, 0.0, null);

    public static NtsValue ofNumber(double value) {
        return new NtsValue(NUMBER, value, null);
    }

    public static NtsValue ofBoolean(boolean value) {
        return new NtsValue(BOOLEAN, value ? 1.0 : 0.0, null);
    }

    public static NtsValue ofString(String value) {
        return value == null ? NULL_VALUE : new NtsValue(STRING, 0.0, value);
    }

    public static NtsValue ofObject(Object value) {
        return value == null ? NULL_VALUE : new NtsValue(OBJECT, 0.0, value);
    }

    /**
     * A boolean back out.
     *
     * <p>A helper rather than a field read because the payload is a
     * {@code double}: {@code ofBoolean} stores 1.0 or 0.0, so reading it back
     * is a comparison, and a comparison at the use site would need a branch and
     * a scratch slot for something that is one instruction here.
     */
    public static boolean asBoolean(NtsValue value) {
        return value.num != 0.0;
    }

    /** What {@code typeof} answers, which is what the tag numbering spells. */
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

    /**
     * JavaScript truthiness, which is not "is it there".
     *
     * <p>{@code 0}, {@code -0}, {@code NaN} and {@code ""} are all falsy and all
     * present; {@code null} and {@code undefined} are falsy and absent. An
     * object is truthy whatever it holds.
     */
    public static boolean truthy(NtsValue value) {
        switch (value.tag) {
            case UNDEFINED:
            case NULL:
                return false;
            case BOOLEAN:
                return value.num != 0.0;
            case NUMBER:
                // `x == x` rejects NaN, which `!= 0` accepts.
                return value.num == value.num && value.num != 0.0;
            case STRING:
                return !((String) value.ref).isEmpty();
            default:
                return true;
        }
    }

    /**
     * {@code ===} between two erased values.
     *
     * <p>Three rules the tag does not give for free. {@code NaN !== NaN},
     * so a number compares by value rather than by bits. {@code -0 === 0}, so
     * it compares by value rather than by bits *again*, in the other direction.
     * And a string compares by its characters, not by identity.
     */
    public static boolean strictEq(NtsValue left, NtsValue right) {
        if (left.tag != right.tag) {
            return false;
        }
        switch (left.tag) {
            case UNDEFINED:
            case NULL:
                return true;
            case BOOLEAN:
            case NUMBER:
                return left.num == right.num;
            case STRING:
                return java.util.Objects.equals(left.ref, right.ref);
            default:
                return left.ref == right.ref;
        }
    }
}
