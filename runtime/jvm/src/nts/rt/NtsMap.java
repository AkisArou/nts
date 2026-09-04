package nts.rt;

/**
 * `Map` and `Set`, as a transliteration of `runtime/c`'s table rather than a
 * wrapper around `LinkedHashMap`.
 *
 * <p>Two reasons, and both are about behaviour rather than speed.
 *
 * <p><b>The iteration contract is a cursor, not an iterator.</b> The lowering
 * emits `nts_map_next(map, from)` -- the next live entry at or after an index,
 * or -1 -- and re-reads the table on every call. That is what makes an entry
 * appended during a walk visible to that walk, and one deleted ahead of the
 * cursor invisible: both of which node does and neither of which a snapshot
 * does. `LinkedHashMap`'s iterator throws `ConcurrentModificationException` for
 * the first and cannot express the second. The whole of the iteration state is
 * one number, so the loop carrying it allocates nothing and specializes like
 * any other counter.
 *
 * <p><b>The keys are SameValueZero, which is neither `equals` nor `==`.</b>
 * `-0` and `0` are the same key and `NaN` is the same key as itself --
 * `Double.equals` gets the second right and the first wrong, and `==` gets it
 * the other way round. So a key is normalized before it reaches a hash table:
 * negative zero becomes zero, and everything else falls out of `Double.equals`
 * and reference identity.
 *
 * <p>`kind` is accepted and ignored. In C it selects a specialised hash and
 * comparison -- a string-keyed map skips the tag checks -- which is an
 * optimisation rather than a semantic, and the normalisation below is uniform.
 * Taking the parameter keeps `hir::runtime` the single answer about what the
 * helper's signature is.
 */
public final class NtsMap {
    /** Insertion order, with holes where entries were deleted. */
    private NtsValue[] keys = new NtsValue[8];
    private NtsValue[] values = new NtsValue[8];
    private boolean[] live = new boolean[8];
    private int used;
    private int count;

    /** Normalised key to slot, so lookup is not a scan. */
    private final java.util.HashMap<Object, Integer> index = new java.util.HashMap<>();

    private NtsMap() {}

    public static NtsMap newMap(double kind) {
        return new NtsMap();
    }

    public static NtsMap newSet(double kind) {
        return new NtsMap();
    }

    /**
     * SameValueZero, as an object a hash table can key on.
     *
     * <p>`Double.equals` says `NaN` equals `NaN`, which the language also says,
     * and says `-0.0` does not equal `0.0`, which it does not. Normalising the
     * one case is the whole difference.
     *
     * <p>An object keys on itself: generated classes do not override `equals`,
     * so the default identity comparison is the language's `===`.
     */
    private static Object keyOf(NtsValue value) {
        switch (value.tag) {
            case NtsValue.NUMBER:
                return Double.valueOf(value.num == 0.0 ? 0.0 : value.num);
            case NtsValue.BOOLEAN:
                return Boolean.valueOf(value.num != 0.0);
            case NtsValue.STRING:
                return value.ref;
            case NtsValue.UNDEFINED:
                return UNDEFINED_KEY;
            case NtsValue.NULL:
                return NULL_KEY;
            default:
                return value.ref == null ? NULL_KEY : value.ref;
        }
    }

    private static final Object UNDEFINED_KEY = new Object();
    private static final Object NULL_KEY = new Object();

    public static NtsValue get(NtsMap map, NtsValue key) {
        Integer at = map.index.get(keyOf(key));
        return at == null ? NtsValue.UNDEFINED_VALUE : map.values[at];
    }

    public static boolean has(NtsMap map, NtsValue key) {
        return map.index.containsKey(keyOf(key));
    }

    /** Returns the collection, which is what `set` and `add` evaluate to. */
    public static NtsMap set(NtsMap map, NtsValue key, NtsValue value) {
        Object normalised = keyOf(key);
        Integer at = map.index.get(normalised);
        if (at != null) {
            // An existing key keeps its position: `m.set(k, 1); m.set(k, 2)`
            // leaves `k` where it first went in.
            map.values[at] = value;
            return map;
        }
        map.append(normalised, key, value);
        return map;
    }

    public static NtsMap add(NtsMap map, NtsValue key) {
        return set(map, key, key);
    }

    private void append(Object normalised, NtsValue key, NtsValue value) {
        if (used == keys.length) {
            int bigger = keys.length * 2;
            keys = java.util.Arrays.copyOf(keys, bigger);
            values = java.util.Arrays.copyOf(values, bigger);
            live = java.util.Arrays.copyOf(live, bigger);
        }
        keys[used] = key;
        values[used] = value;
        live[used] = true;
        index.put(normalised, used);
        used++;
        count++;
    }

    public static boolean delete(NtsMap map, NtsValue key) {
        Integer at = map.index.remove(keyOf(key));
        if (at == null) {
            return false;
        }
        // The slot stays, dead. Compacting would move every later entry and
        // silently advance any cursor walking the table.
        map.live[at] = false;
        map.keys[at] = null;
        map.values[at] = null;
        map.count--;
        return true;
    }

    public static void clear(NtsMap map) {
        map.index.clear();
        java.util.Arrays.fill(map.live, 0, map.used, false);
        java.util.Arrays.fill(map.keys, 0, map.used, null);
        java.util.Arrays.fill(map.values, 0, map.used, null);
        map.count = 0;
    }

    public static double size(NtsMap map) {
        return map.count;
    }

    /**
     * The next live entry at or after `from`, or -1.
     *
     * <p>Re-read every call rather than snapshotted, which is the contract: an
     * entry appended during a walk is seen by that walk, and one deleted ahead
     * of the cursor is not.
     */
    public static double next(NtsMap map, double from) {
        int at = from < 0.0 ? 0 : (int) from;
        while (at < map.used) {
            if (map.live[at]) {
                return at;
            }
            at++;
        }
        return -1.0;
    }

    public static NtsValue keyAt(NtsMap map, double at) {
        int slot = (int) at;
        if (slot < 0 || slot >= map.used || !map.live[slot]) {
            return NtsValue.UNDEFINED_VALUE;
        }
        return map.keys[slot];
    }

    public static NtsValue valueAt(NtsMap map, double at) {
        int slot = (int) at;
        if (slot < 0 || slot >= map.used || !map.live[slot]) {
            return NtsValue.UNDEFINED_VALUE;
        }
        return map.values[slot];
    }
}
