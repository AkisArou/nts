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

    /**
     * `String(v)` on a value carrying its own tag.
     *
     * <p>Exact for `undefined`, `null`, a boolean, a number and a string. Every
     * other tag **aborts rather than guessing**, which is the C lane's rule and
     * is worth keeping rather than falling back to `toString`: a value tagged
     * `OBJECT` reaching here is a lowering that should have refused, and
     * answering `[object Object]` would turn a compiler bug into a plausible
     * string that some test then bakes in.
     *
     * <p>The number goes through {@link NtsRuntime#numberText}, not
     * `Double.toString`, because the two disagree -- `1e21` against `1.0E21`
     * among others -- and node's spelling is the one this has to match.
     */
    public static String valueToString(NtsValue value) {
        if (value == null) {
            throw new NtsRefusal("String() on a value that is not there");
        }
        switch (value.tag) {
            case UNDEFINED:
                return "undefined";
            case NULL:
                return "null";
            case BOOLEAN:
                return value.num != 0.0 ? "true" : "false";
            case NUMBER:
                return NtsRuntime.numberText(value.num);
            case STRING:
                return (String) value.ref;
            default:
                throw new NtsRefusal("String() on tag " + value.tag
                    + ", which the lowering should have refused rather than reaching here");
        }
    }

    /** `instanceof ArrayBuffer`, which is one class here and one descriptor there. */
    public static boolean isBuffer(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsBuffer;
    }

    /**
     * `instanceof DataView`, which needs no kind beside it.
     *
     * <p>`isViewKind` takes one because the twelve typed arrays are twelve
     * classes under `NtsView` and the lowering has to say which. There is
     * exactly one `DataView`, so the class *is* the answer -- and this is a
     * plain `instanceof` rather than a switch for the same reason `isBuffer`
     * is.
     *
     * <p>It cannot answer true for a typed array: `NtsDataView` is `final` and
     * extends `NtsAnyView` directly, while every typed array extends
     * `NtsView`, so the two are siblings rather than one being under the other.
     * That is worth stating because `NtsAnyView` would have matched both and is
     * the obvious thing to reach for.
     */
    public static boolean isDataView(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsDataView;
    }

    /**
     * {@code ArrayBuffer.isView(x)} -- a typed array <em>or</em> a
     * {@code DataView}, and not the buffer either of them is over.
     *
     * <p>{@link NtsAnyView} is what {@link #isDataView} above deliberately does
     * <em>not</em> reach for, because there it would match both and the
     * question is only one of them. Here matching both is the question:
     * {@code NtsDataView} extends it directly and every typed array extends
     * {@code NtsView}, which also extends it.
     *
     * <p>And it excludes an {@code ArrayBuffer} by construction rather than by
     * a check -- {@code NtsBuffer} is a plain final class and extends nothing.
     * Those two and no others extend {@code NtsAnyView}, which is the whole of
     * why this one line is the definition.
     */
    public static boolean isView(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsAnyView;
    }

    /**
     * `array[index]` where the array is erased and the element type is not
     * known until run time -- `nts_array_element`.
     *
     * <p>**Eight arms, and the first version had six.** A `number[]` is a bare
     * `double[]` in one program and an `NtsArrayD` in another, because
     * `arrays_can_grow` is whole-program: one `push` anywhere puts every array
     * in a wrapper. Both spellings reach here.
     *
     * <p>**And a `number[]` is not always eight bytes of `double`.** I told the
     * other lane their `int64_t`-versus-`double` ambiguity could not arise here
     * because "a `number[]` is always a `double[]`", and
     * `examples/dynamic-element` emits `newarray long` for
     * `[4294967296, 4503599627370495]` -- integers past 2^32 that stay inside
     * the safe integers, which is exactly the case they described. The
     * differential caught it: we answered -1 where node answered
     * 9007199254740990.
     *
     * <p>The C lane needs a descriptor field to tell those apart. Here a Java
     * array carries its own type, so `instanceof` separates `long[]` from
     * `double[]` for nothing -- but only if the arm exists, and mine did not.
     *
     * <p>**An unrecognised representation refuses rather than answering
     * `undefined`.** That is the whole of what went wrong above: a missing arm
     * fell through to the out-of-range answer, so a wrong number looked like an
     * absent element and `typeof` said so consistently. Out of range is a real
     * `undefined` and a shape this method does not know is not.
     *
     * <p>**Length comes from `length()` and not from `items.length`** for the
     * wrapped forms: the backing store is larger than the count after a
     * `push`, so the array's own tail would read as real elements.
     *
     * <p>Out of range answers `undefined` rather than throwing, which is what
     * the erased return type is for and what JavaScript does. A non-integral or
     * negative index answers the same -- `a[1.5]` is a property read in
     * JavaScript and there is no property here.
     */
    public static NtsValue arrayElement(NtsValue array, double index) {
        Object ref = array == null ? null : array.ref;
        if (ref == null) {
            return UNDEFINED_VALUE;
        }
        int at = (int) index;
        if (at < 0 || (double) at != index) {
            return UNDEFINED_VALUE;
        }
        if (ref instanceof NtsArrayD) {
            NtsArrayD xs = (NtsArrayD) ref;
            return at < (int) NtsArrayD.length(xs) ? ofNumber(xs.items[at]) : UNDEFINED_VALUE;
        }
        if (ref instanceof NtsArrayZ) {
            NtsArrayZ xs = (NtsArrayZ) ref;
            return at < (int) NtsArrayZ.length(xs) ? ofBoolean(xs.items[at]) : UNDEFINED_VALUE;
        }
        if (ref instanceof NtsArrayL) {
            NtsArrayL xs = (NtsArrayL) ref;
            return at < (int) NtsArrayL.length(xs) ? held(xs.items[at]) : UNDEFINED_VALUE;
        }
        if (ref instanceof double[]) {
            double[] xs = (double[]) ref;
            return at < xs.length ? ofNumber(xs[at]) : UNDEFINED_VALUE;
        }
        if (ref instanceof boolean[]) {
            boolean[] xs = (boolean[]) ref;
            return at < xs.length ? ofBoolean(xs[at]) : UNDEFINED_VALUE;
        }
        if (ref instanceof long[]) {
            long[] xs = (long[]) ref;
            return at < xs.length ? ofNumber((double) xs[at]) : UNDEFINED_VALUE;
        }
        if (ref instanceof int[]) {
            int[] xs = (int[]) ref;
            return at < xs.length ? ofNumber((double) xs[at]) : UNDEFINED_VALUE;
        }
        if (ref instanceof Object[]) {
            Object[] xs = (Object[]) ref;
            return at < xs.length ? held(xs[at]) : UNDEFINED_VALUE;
        }
        throw new NtsRefusal(
            "an indexed read of an erased array held as "
                + ref.getClass().getName()
                + ", which nts_array_element has no arm for");
    }

    /**
     * One reference element, tagged for what it is.
     *
     * <p>`ofObject` would give a `String` the OBJECT tag, so `typeof` would
     * answer `"object"` for a string read out of an erased array. The three
     * cases are separated here rather than at each caller so they cannot drift.
     */
    private static NtsValue held(Object element) {
        if (element == null) {
            return UNDEFINED_VALUE;
        }
        if (element instanceof NtsValue) {
            return (NtsValue) element;
        }
        if (element instanceof String) {
            return ofString((String) element);
        }
        return ofObject(element);
    }

    /**
     * `instanceof Date`.
     *
     * <p>One class, one form, and no bit to read beside it -- `isBuffer`'s
     * shape rather than `isMap`'s. `NtsDate` is `final` and stands alone, so
     * unlike `DataView` there is no sibling to be confused with and unlike
     * `Map` there is no second thing sharing the class.
     */
    public static boolean isDate(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsDate;
    }

    /**
     * `instanceof Map` and `instanceof Set`, which are **one class here**.
     *
     * <p>This is the pair `isBuffer`'s one-line shape does not survive.
     * `newMap` and `newSet` both answer an `NtsMap`, so `ref instanceof NtsMap`
     * is true for either and each of these would be right half the time --
     * silently, with no example asking. The bit they consult is
     * `NtsMap.builtAsMap`, added for exactly this and measured at **zero
     * bytes**: three cases including `array-from` at 8.28 MB/op report the same
     * allocation to the byte before and after, because a boolean fits in the
     * padding the object already had.
     *
     * <p>Written as one predicate and its negation rather than two independent
     * tests, so they cannot drift into both answering true.
     */
    public static boolean isMap(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsMap && NtsMap.builtAsMap((NtsMap) ref);
    }

    /** `instanceof Set`; see {@link #isMap}, whose bit this reads the other way. */
    public static boolean isSet(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsMap && !NtsMap.builtAsMap((NtsMap) ref);
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
