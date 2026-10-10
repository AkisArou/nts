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
    /**
     * An erased `bigint`: `ref` is an immutable {@link NtsBigInt}. The value
     * `runtime/c` gives `NTS_BIGINT`, outside the native handles' 8..15.
     *
     * <p>**Above `OBJECT`, so a `tag >= OBJECT` range test admits it** -- and
     * `typeof 1n` is "bigint", not "object". Every reader here names it
     * explicitly; the emitted object test has to stop being a range for the
     * same reason. Compared and hashed by *value*: `NtsBigInt` shares
     * constants (`ZERO`), so identity is wrong both ways.
     */
    public static final int BIGINT = 16;
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
    /**
     * A tagged reference -- a function, a symbol, a bigint -- whose absence is
     * `undefined`: {@link #ofTagged} reads a null reference as `null`, which is
     * right only when the absence is `null`. The sibling of
     * {@link #ofStringOrUndefined} and {@link #ofObjectOrUndefined}.
     */
    public static NtsValue ofTaggedOrUndefined(int tag, Object value) {
        return value == null ? UNDEFINED_VALUE : new NtsValue(tag, 0.0, value);
    }
    public static NtsValue ofObject(Object value) {
        return value == null ? NULL_VALUE : new NtsValue(OBJECT, 0.0, value);
    }
    /**
     * A reference arriving with no tag, tagged by what it is: `runtime/c`'s
     * `nts_tag_of_reference`. A string is `STRING` and a symbol `SYMBOL`;
     * anything else is `OBJECT`, as there.
     *
     * <p>For the promise helpers that take a bare reference. `reject` used
     * {@link #ofObject}, so `Promise.reject("text")` rejected with an object
     * that happened to hold a string: `typeof e` in the `catch` answered
     * `"object"` where node and C answer `"string"`, and an unhandled one was
     * reported as `nts: uncaught String` (2026-10-02).
     */
    public static NtsValue ofBigInt(NtsBigInt value) {
        return value == null ? NULL_VALUE : new NtsValue(BIGINT, 0.0, value);
    }
    public static NtsValue ofReference(Object value) {
        if (value instanceof String) { return new NtsValue(STRING, 0.0, value); }
        if (value instanceof NtsSymbol) { return new NtsValue(SYMBOL, 0.0, value); }
        if (value instanceof NtsBigInt) { return new NtsValue(BIGINT, 0.0, value); }
        return ofObject(value);
    }
    /**
     * A reference that may be absent, where absent means `undefined`.
     *
     * <p>`ofObject` answers `null` for a null reference, which is right for
     * `T | null` and wrong for `T | undefined` -- and the representation cannot
     * tell them apart, because a reference and both of its absences are one
     * null. `OpKind::Erase` carries which, and this is the other answer.
     *
     * <p>This lane had the `T | null` half right by construction and the
     * `T | undefined` half wrong; the C lane had it the other way round, which
     * is the usual shape -- the two native backends agree by luck because
     * neither looks, and the JVM is where the difference shows.
     */
    public static NtsValue ofObjectOrUndefined(Object value) {
        return value == null ? UNDEFINED_VALUE : new NtsValue(OBJECT, 0.0, value);
    }
    /**
     * A string whose absence is `undefined`: an element of a `(string |
     * undefined)[]`, whose empty slot is the null reference. `ofString` reads
     * that null as `null`, and {@link #ofObjectOrUndefined} would tag a present
     * one `OBJECT`.
     */
    public static NtsValue ofStringOrUndefined(String value) {
        return value == null ? UNDEFINED_VALUE : new NtsValue(STRING, 0.0, value);
    }
    /**
     * An element read from an array of erased values. A slot nothing stored
     * into is the null reference here, where C's zeroed memory is already
     * {@code undefined}: {@code new Array(2)} read at 1 is a hole, and a hole
     * reads {@code undefined}.
     */
    public static NtsValue orUndefined(NtsValue value) {
        return value == null ? UNDEFINED_VALUE : value;
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
            || ref instanceof NtsArrayZ
            || ref instanceof NtsTemplate;
    }

    /**
     * `Number(v)` on a value carrying its own tag, and `+v` since unary plus
     * became the same operation.
     *
     * <p>The five arms `runtime/c`'s `nts_value_to_number` has, in the same
     * order and with the same answers, because `hir::runtime` is one table and
     * a conversion with two implementations has two answers -- which this
     * runtime learned from `numberText` spelling `1.5` as `1.50000` beside a
     * `numberToString` that did not.
     *
     * <p>The `default` is `NaN` and is unreachable by construction, for the
     * reason the C arm states: `ToNumber` of an object is `ToPrimitive` first,
     * which runs `valueOf` and `toString` off a prototype chain -- `Number([])`
     * is 0 and `Number([5])` is 5, and neither is producible here. So the
     * lowering emits this only where the checker's type admits no object. The
     * arm exists because a tag switch with a hole is worse than one with an
     * answer that cannot be reached, and `NaN` is what the specification gives
     * for a plain `{}` anyway.
     */
    public static double valueToNumber(NtsValue value) {
        if (value == null) {
            throw new NtsRefusal("Number() on a value that is not there");
        }
        switch (value.tag) {
            case NUMBER:
                return value.num;
            case BOOLEAN:
                return value.num != 0.0 ? 1.0 : 0.0;
            case STRING:
                return NtsRuntime.strToNumber((String) value.ref);
            case NULL:
                return 0.0;
            case BIGINT:
                // ToNumber of a bigint is a TypeError; `Number(x)` is the
                // explicit conversion and is `valueToNumberExplicit`. Refused by
                // name until a raise contract lets the runtime throw it.
                throw NtsRefusal.missing("an implicit conversion of a bigint to a number, "
                    + "which is a TypeError");
            default:
                return Double.NaN;
        }
    }

    /** `Number(v)`: as {@link #valueToNumber}, except that a bigint converts (`Number(1n)` is 1). */
    public static double valueToNumberExplicit(NtsValue value) {
        if (value != null && value.tag == BIGINT) {
            return NtsBigInt.toNumber((NtsBigInt) value.ref);
        }
        return valueToNumber(value);
    }

    /**
     * `String(v)` on a value carrying its own tag.
     *
     * <p>Exact for every tag the table defines except `FUNCTION`, which aborts
     * because node answers with the function's source text and this compiler
     * keeps none. That refusal is the C lane's rule and is worth keeping: any
     * string invented for it would be a plausible one that some test bakes in.
     *
     * <p>`OBJECT` used to abort here too, on the ground that reaching it was a
     * lowering that should have refused. `spells_itself` admits `unknown` now,
     * so it is reached deliberately and answered -- see {@link #objectText}.
     *
     * <p>The number goes through {@link NtsRuntime#numberText}, which is
     * {@link NtsRuntime#numberToString}, not `Double.toString`: the two
     * disagree -- `1e21` against `1.0E21` among others -- and node's spelling is
     * the one this has to match. It is the **same** converter the typed path
     * uses, which is the point; it was a separate one until 2026-09-12 and
     * spelled `1.5` as `1.50000`.
     */
    /** An argument of {@code console.log}: {@code String(v)}, except that negative zero is {@code -0}. */
    public static String valueInspect(NtsValue value) {
        if (value != null && value.tag == NUMBER && value.num == 0.0 && 1.0 / value.num < 0.0) {
            return "-0";
        }
        // `console.log(5n)` prints `5n`; `String(5n)` is `"5"`.
        if (value != null && value.tag == BIGINT) {
            return NtsBigInt.toText((NtsBigInt) value.ref) + "n";
        }
        return valueToString(value);
    }
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
            case OBJECT:
                return objectText(value.ref);
            case SYMBOL:
                // `SymbolDescriptiveString`, and **`NtsSymbol.describe` rather
                // than a second copy of it**: `String(sym)` on a typed symbol
                // already goes there through `nts_symbol_to_string`, and the
                // erased arm answering `"Symbol(" + d + ")"` independently
                // would be two spellings of one rule that could drift on
                // `Symbol()` with no description -- which prints `Symbol()` and
                // whose `.description` is `undefined`, not `""`.
                return NtsSymbol.describe((NtsSymbol) value.ref);
            case FUNCTION:
                // A closure or a class token is a generated object like any
                // other, and its class says how it prints: a function's text,
                // `function () { [native code] }`, since node's -- the source
                // -- is not kept. Asked of the object, so the tag and a closure
                // read back out of an array tagged `OBJECT` agree.
                return objectText(value.ref);
            case BIGINT:
                return NtsBigInt.toText((NtsBigInt) value.ref);
            default:
                throw new NtsRefusal("String() on tag " + value.tag
                    + ", which is not a tag this table defines");
        }
    }

    /**
     * `String(o)` for an erased object, which is three questions in one.
     *
     * <p>An object that declares its own `toString` answers with it; an array
     * answers with its elements joined by a comma; anything else is
     * `"[object Object]"`, which is not a fallback but the right answer -- an
     * object whose prototype chain adds nothing *is* that string.
     */
    private static String objectText(Object ref) {
        if (ref == null) {
            return "null";
        }
        if (ref instanceof NtsSymbol) {
            // An erased symbol arrives tagged `OBJECT` (`hir::tags`), and the
            // class is what knows it is one.
            return NtsSymbol.describe((NtsSymbol) ref);
        }
        // Everything the program made: its class's answer, from the
        // compiler's table, as `runtime/c` reads a descriptor's `to_string`.
        if (ref instanceof NtsPrintable) {
            return ((NtsPrintable) ref).nts$print();
        }
        if (ref.getClass().isArray() || ref instanceof NtsArrayD || ref instanceof NtsArrayL
            || ref instanceof NtsArrayZ || ref instanceof NtsTemplate) {
            return arrayText(ref);
        }
        // The runtime's own objects, as `Object.prototype.toString` names
        // them. A dictionary before the `Map` it extends.
        if (ref instanceof NtsDictionary) {
            return "[object Object]";
        }
        if (ref instanceof NtsMap) {
            return "[object Map]";
        }
        if (ref instanceof NtsSet) {
            return "[object Set]";
        }
        if (ref instanceof NtsPromise) {
            return "[object Promise]";
        }
        if (ref instanceof NtsBuffer) {
            return "[object ArrayBuffer]";
        }
        if (ref instanceof NtsDataView) {
            return "[object DataView]";
        }
        if (ref instanceof NtsView) {
            return NtsView.join((NtsView) ref, ",");
        }
        // A runtime class nobody taught to print -- a `Date`, whose text
        // depends on the time zone, among them -- stops by name rather than
        // answering `"[object Object]"` for it.
        if (ref.getClass().getName().startsWith("nts.rt.")) {
            throw new NtsRefusal("String() of a " + ref.getClass().getSimpleName()
                + ", which this runtime does not print");
        }
        // A bound Java object: its text is what the Java API says it is.
        return ref.toString();
    }

    /** What a generated class whose type says nothing about how it prints
     *  answers from `nts$print`: a refusal naming it. */
    public static String unprintable(String layout) {
        throw new NtsRefusal("String() of `" + layout + "`, whose type says nothing about how "
            + "it prints");
    }

    /** `f.name` where the type does not settle it: the function's class says
     *  ({@link NtsNamed}), or nothing does and it stops by name. */
    public static String functionName(NtsValue function) {
        return nameOf(function.ref);
    }

    /** What a function object is called, as {@link #functionName} answers. */
    public static String nameOf(Object function) {
        if (function instanceof NtsNamed) {
            return ((NtsNamed) function).nts$name();
        }
        throw new NtsRefusal("the name of `" + (function == null ? "?"
            : function.getClass().getSimpleName()) + "`, whose type does not say what it "
            + "is called");
    }

    /** A bound function's name, whose target is known only at run time:
     *  `"bound "` and the target's. `runtime/c` reads the same off a
     *  descriptor marked `nts_bound_function_name`. */
    public static String boundName(Object target) {
        return "bound " + nameOf(target);
    }

    /** What a generated function class with no name answers where its text
     *  is asked for: a refusal naming it, as {@link #functionName} makes. */
    public static String unnamed(String layout) {
        throw new NtsRefusal("the name of `" + layout + "`, whose type does not say what it "
            + "is called");
    }

    /** A function's text, as node prints one it has no source for -- a
     *  built-in's, with its name. `runtime/c`'s `nts_function_to_string`. */
    public static String functionText(String name) {
        return "function " + name + "() { [native code] }";
    }

    /**
     * The elements, comma-joined, with `null` and `undefined` contributing the
     * empty string and a nested array recursing.
     *
     * <p>**`java.lang.reflect.Array` rather than a chain against every element
     * type**, for the reason {@link #isArray} gives for using
     * `getClass().isArray()`: the element analysis chooses `double[]`, `int[]`,
     * `long[]`, `boolean[]` or `Object[]` depending on what it proved, and a
     * chain covering the ones that exist today goes stale the first time it
     * proves something new. The compiler lane hit exactly that on 2026-09-12 --
     * a join that read `int32_t[]` storage as 8-byte doubles and answered
     * nineteen characters where three were wanted.
     *
     * <p>Reflection is affordable here because `String(array)` is a diagnostic
     * path, not a hot one; the alternative is a correctness hazard on every
     * future element type.
     */
    public static void templateReflection(NtsValue value) {
        if (value != null && value.ref instanceof NtsTemplate) {
            throw new NtsRefusal("reflecting on a cooked-only template object");
        }
    }

    public static Object arrayReference(Object ref) {
        if (ref instanceof NtsTemplate) {
            throw new NtsRefusal("converting an immutable template object to writable array storage");
        }
        return ref;
    }

    private static String arrayText(Object ref) {
        if (ref instanceof NtsTemplate) {
            NtsTemplate template = (NtsTemplate) ref;
            StringBuilder text = new StringBuilder();
            for (int at = 0; at < NtsTemplate.count(template); at++) {
                if (at > 0) text.append(',');
                text.append(NtsTemplate.get(template, at));
            }
            return text.toString();
        }
        Object items = ref;
        int count = -1;
        if (ref instanceof NtsArrayD) {
            items = ((NtsArrayD) ref).items;
            count = NtsArrayD.count((NtsArrayD) ref);
        } else if (ref instanceof NtsArrayL) {
            items = ((NtsArrayL) ref).items;
            count = NtsArrayL.count((NtsArrayL) ref);
        } else if (ref instanceof NtsArrayZ) {
            items = ((NtsArrayZ) ref).items;
            count = NtsArrayZ.count((NtsArrayZ) ref);
        }
        if (count < 0) {
            count = java.lang.reflect.Array.getLength(items);
        }
        // An array being joined, met again inside itself, prints as empty --
        // node's join keeps the same stack -- rather than recursing until the
        // thread's stack runs out. By identity: two equal arrays are two.
        for (Object outer : JOINING) {
            if (outer == ref) {
                return "";
            }
        }
        JOINING.add(ref);
        try {
            StringBuilder text = new StringBuilder();
            for (int at = 0; at < count; at++) {
                if (at > 0) {
                    text.append(',');
                }
                text.append(elementText(java.lang.reflect.Array.get(items, at)));
            }
            return text.toString();
        } finally {
            JOINING.remove(JOINING.size() - 1);
        }
    }

    /** The arrays `arrayText` is inside of; one thread, as the event loop is. */
    private static final java.util.ArrayList<Object> JOINING = new java.util.ArrayList<>();

    /** One element of a joined array, by the rules `Array.prototype.join` uses. */
    private static String elementText(Object element) {
        if (element == null) {
            return "";
        }
        if (element instanceof NtsValue) {
            NtsValue held = (NtsValue) element;
            // `join` renders `null` and `undefined` as the empty string, which
            // is the one place it differs from `String()` of the same value.
            return held.tag == NULL || held.tag == UNDEFINED ? "" : valueToString(held);
        }
        if (element instanceof String) {
            return (String) element;
        }
        if (element instanceof Boolean) {
            return ((Boolean) element) ? "true" : "false";
        }
        if (element instanceof Character) {
            return String.valueOf(((Character) element).charValue());
        }
        if (element instanceof Number) {
            return NtsRuntime.numberText(((Number) element).doubleValue());
        }
        return objectText(element);
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
    /**
     * An erased optional endpoint as a number, or the fallback when it is absent.
     *
     * <p>**Not {@code ToNumber}.** A string gives {@code NaN} rather than being
     * parsed, and nothing reaches {@code valueOf}. That is deliberate: this
     * exists for an optional argument that is a number or is missing, and a
     * string arriving here is a program the compiler should have refused rather
     * than one this should coerce.
     *
     * <p>{@code undefined} and {@code null} both take the fallback -- absent is
     * absent -- and a boolean is 0 or 1, which is the one conversion the
     * specification does perform on this path.
     */
    public static double numberOr(NtsValue value, double fallback) {
        switch (value == null ? NULL : value.tag) {
            case UNDEFINED:
            case NULL:
                return fallback;
            case NUMBER:
                return value.num;
            case BOOLEAN:
                return value.num != 0.0 ? 1.0 : 0.0;
            default:
                return Double.NaN;
        }
    }

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
    /**
     * `array.length` where the array is erased -- `Length` of an erased operand,
     * which lowering emits after its checked array-shape guard.
     *
     * <p>**Every representation by what it is, never by what it might be.** A
     * wrapper's live count (its `length`, not its backing store's, which is
     * larger after a `push`); a template's count; and a bare JVM array of any
     * element type, through
     * `java.lang.reflect.Array` for {@link #isArray}'s reason -- the element
     * analysis picks `double[]`, `int[]`, `long[]`, `boolean[]` or `Object[]`,
     * and a chain of the widths that exist today goes stale on the next.
     * Anything else refuses by class name: the guard said "an array", so a value
     * that is not one is a defect to report, not an `undefined` to answer.
     *
     * <p>**A tuple refuses, by name.** It is a struct with named fields here and
     * carries no position count at run time -- nor does C's tuple header -- so
     * its length is a protocol of its own (layout metadata every backend
     * reads), not something this helper may guess at.
     */
    public static int arrayLength(NtsValue array) {
        Object ref = array == null ? null : array.ref;
        if (ref instanceof NtsArrayD) {
            return ((NtsArrayD) ref).length;
        }
        if (ref instanceof NtsArrayL) {
            return ((NtsArrayL) ref).length;
        }
        if (ref instanceof NtsArrayZ) {
            return ((NtsArrayZ) ref).length;
        }
        if (ref instanceof NtsTemplate) {
            return NtsTemplate.count((NtsTemplate) ref);
        }
        if (ref instanceof NtsTuple) {
            throw new NtsRefusal("the length of an erased tuple, which carries no position count at run time");
        }
        if (ref != null && ref.getClass().isArray()) {
            return java.lang.reflect.Array.getLength(ref);
        }
        throw new NtsRefusal("the length of an erased value held as "
            + (ref == null ? "no reference" : ref.getClass().getName())
            + ", which the array-shape guard should have refused");
    }

    public static NtsValue arrayElement(NtsValue array, double index) {
        Object ref = array == null ? null : array.ref;
        if (ref == null) {
            return UNDEFINED_VALUE;
        }
        int at = (int) index;
        if (at < 0 || (double) at != index) {
            return UNDEFINED_VALUE;
        }
        if (ref instanceof NtsTemplate) {
            NtsTemplate template = (NtsTemplate) ref;
            return at < NtsTemplate.count(template) ? ofString(NtsTemplate.get(template, at)) : UNDEFINED_VALUE;
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
        // A bare reference tags by what it is -- a string, a symbol, a bigint --
        // which is `ofReference`; `ofObject` tagged an NtsBigInt or NtsSymbol
        // element OBJECT, so `typeof xs[0]` answered "object" for either.
        return ofReference(element);
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
     * <p>Was one predicate and its negation over a boolean field, written that
     * way so the two could not drift into both answering true. **The classes
     * carry it now**, so they cannot: `NtsMap` and `NtsSet` are siblings under
     * {@link NtsTable} and no object is both. A bit that two predicates had to
     * agree about became a fact only one of them can match, which is the
     * stronger form of the same guarantee -- and one fewer field per table.
     */
    public static boolean isMap(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        // A dictionary shares a `Map`'s storage and is not one.
        return ref instanceof NtsMap && !(ref instanceof NtsDictionary);
    }

    /** `instanceof Set`; the sibling of {@link #isMap} under `NtsTable`. */
    public static boolean isSet(NtsValue value) {
        Object ref = value == null ? null : value.ref;
        return ref instanceof NtsSet;
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
            case BIGINT: return "bigint";
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
            case BIGINT: return !NtsBigInt.eq((NtsBigInt) value.ref, NtsBigInt.ZERO);
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
            case BIGINT: return NtsBigInt.eq((NtsBigInt) left.ref, (NtsBigInt) right.ref);
            default: return left.ref == right.ref;
        }
    }
}
