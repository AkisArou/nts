package nts.rt;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A symbol, which is a description and an identity.
 *
 * <p>The identity is the whole of it: two symbols with the same description are
 * different values, which is why this is a class and not a `String`, and why
 * `NtsMap` keys it through the `default` arm of `sameKey` -- reference equality
 * -- rather than through any of the tagged ones.
 *
 * <p>`Symbol()` with no argument has **no** description, which is a different
 * value from `Symbol("")`: `String(Symbol())` and `String(Symbol(""))` are both
 * `"Symbol()"`, and `.description` is `undefined` against `""`. So the field is
 * nullable and the two are only distinguishable by reading it.
 */
public final class NtsSymbol {
    /** The description, or null for `Symbol()` with no argument. */
    public final String description;

    private NtsSymbol(String description) { this.description = description; }

    /** `Symbol(d)`, which is a fresh identity every time. */
    public static NtsSymbol newSymbol(String description) {
        return new NtsSymbol(description);
    }

    /**
     * The `Symbol.for` registry, keyed by string.
     *
     * <p>Insertion-ordered because `keyFor` walks it and a stable order makes a
     * failing test say the same thing twice.
     */
    private static final Map<String, NtsSymbol> REGISTRY = new LinkedHashMap<String, NtsSymbol>();

    /** `Symbol.for(k)`, which interns: every call after the first is the same object. */
    public static NtsSymbol forKey(String key) {
        NtsSymbol found = REGISTRY.get(key);
        if (found == null) {
            found = new NtsSymbol(key);
            REGISTRY.put(key, found);
        }
        return found;
    }

    /**
     * `Symbol.keyFor(s)`, or null for a symbol that was never registered.
     *
     * <p>Walked rather than looked up, which is `runtime/c`'s choice and its
     * reason: the registry maps key to symbol and this asks the other way, and
     * a second index would cost every `Symbol.for` a write to keep it. It is
     * the rare direction.
     */
    public static String keyFor(NtsSymbol symbol) {
        if (symbol == null) {
            return null;
        }
        for (Map.Entry<String, NtsSymbol> entry : REGISTRY.entrySet()) {
            if (entry.getValue() == symbol) {
                return entry.getKey();
            }
        }
        return null;
    }

    /** `.description`, which is `undefined` -- null here -- when there was none. */
    public static String description(NtsSymbol symbol) {
        return symbol == null ? null : symbol.description;
    }

    /** `String(s)`: `Symbol(d)`, and `Symbol()` when there is no description. */
    public static String describe(NtsSymbol symbol) {
        String inside = symbol == null ? null : symbol.description;
        return inside == null ? "Symbol()" : "Symbol(" + inside + ")";
    }
}
