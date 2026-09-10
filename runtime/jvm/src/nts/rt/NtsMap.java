package nts.rt;

import java.util.Arrays;

/**
 * Insertion-ordered SameValueZero table. The double-valued public ABI is unchanged.
 *
 * <p>The open-addressed index contains a cached hash and an insertion slot, not
 * boxed keys, boxed slots or HashMap nodes. A null key slot is a deletion hole;
 * Java null is not a valid NtsValue (JS null is NtsValue.NULL_VALUE).
 *
 * <p>Cursors are absolute insertion positions. base lets clear() and removal of
 * an all-dead prefix reuse storage without invalidating outstanding cursors.
 * Interior holes cannot be reused: a surviving old entry may precede them.
 * This collection, like the event loop, is confined to one execution thread.
 */
public final class NtsMap {
    private static final NtsValue[] EMPTY_VALUES = new NtsValue[0];
    private static final long[] EMPTY_INDEX = new long[0];
    private static final NtsValue ZERO_KEY = NtsValue.ofNumber(0.0);
    /**
     * Below this many live entries a lookup walks insertion order instead of
     * hashing, and the bucket array is never allocated.
     *
     * <p>**Eight, measured rather than guessed, and the measurement is that the
     * threshold barely matters.** `async-profiler` put `findLinear` at 20.64%
     * of `symbol-keyed-map` — four entries, 8,192 lookups — and setting this to
     * zero so every lookup hashes moved that row **3.35x to 3.29x**. Two
     * percent. The scan was where the cycles were and hashing costs nearly the
     * same, so almost none of the 20% was removable.
     *
     * <p>Kept at eight because always hashing also allocates a `long[]` for
     * every map that never grows past a handful, which `array-from` and
     * `map-and-set` both create per call, and two percent on one row does not
     * buy that.
     */
    private static final int LINEAR_LIMIT = 8;
    private static final int MAX_ARRAY = Integer.MAX_VALUE - 8;

    private NtsValue[] keys = EMPTY_VALUES;
    private NtsValue[] values = EMPTY_VALUES;
    // Upper 32 bits: hash. Lower 32 bits: local slot + 1. Zero: empty.
    private long[] buckets = EMPTY_INDEX;
    private int used;
    private int count;
    private int head;
    private int base;
    private int threshold;

    /**
     * Whether this was built as a `Map` or as a `Set`.
     *
     * <p>**The two are one class here, and nothing recorded which was which.**
     * `newMap` and `newSet` both answered `new NtsMap()` and both dropped the
     * argument they were handed -- and that argument is not the distinction
     * anyway: `kind` is `key_kind_of(key)`, the *key type*, which the C lane
     * uses to pick a hash and this one does not need because every key is an
     * `NtsValue`. C carries the map-or-set bit separately, as
     * `nts_map_alloc(kind, true)` against `(kind, false)`, and this lane
     * carried it nowhere.
     *
     * <p>Nothing has been wrong yet, because nothing asks. `instanceof Map` and
     * `instanceof Set` are the first things that will, and without this field
     * both would have to answer `instanceof NtsMap` -- true for the other one,
     * silently, which is the failure this backend refuses by name everywhere
     * else. Found while checking what `isSet` could be written as, before the
     * other lane had built the half that would have depended on it.
     */
    private final boolean map;

    private NtsMap(boolean map) { this.map = map; }

    public static NtsMap newMap(double kind) { return new NtsMap(true); }
    public static NtsMap newSet(double kind) { return new NtsMap(false); }

    /** Whether `map` was built as a `Map`; see the field. */
    public static boolean builtAsMap(NtsMap map) { return map.map; }
    public static double size(NtsMap map) { return map.count; }

    /**
     * A copy in insertion order, keeping whether the source was a `Map` or a
     * `Set`.
     *
     * <p>`{ ...table }` over a `Record<string, V>` is what reaches here, and
     * insertion order is not an implementation detail: JavaScript specifies it
     * for string keys, so a copy that rebuilt the table by hashing would print
     * its keys in a different order than node and the differential would say
     * so on the first spread.
     *
     * <p>Re-inserted through {@link #set} and {@link #add} rather than by
     * copying the arrays, so the copy has whatever invariants those maintain
     * -- the bucket index, the linear-scan threshold, the head and base -- and
     * a future change to them does not have to remember this method exists.
     * A source with deleted slots is compacted by the walk, which is correct
     * and is why the count comes out right.
     */
    /**
     * `Object.keys` of a string-keyed table, in insertion order.
     *
     * <p>Declared `Object[]` rather than `String[]` because that is what this
     * runtime's reference-array signatures are: Java arrays are covariant, so
     * the `String[]` the caller wants verifies on the way in, and the emitter
     * spells the narrowing back on the way out.
     *
     * <p>Reads `key.ref` rather than going through `NtsValue`, which is exact
     * here and only here: a *string-keyed* table's keys are STRING-tagged by
     * construction, and this helper's name says so. It is not a general key
     * reader and a numeric key would come back as whatever `ref` held.
     */
    public static Object[] keysStr(NtsMap map) {
        // **`new String[]`, not `new Object[]`.** Declaring the return
        // `Object[]` is right and allocating one is not: Java's array
        // covariance lets a `String[]` be *passed* where an `Object[]` is
        // wanted, and does not let an `Object[]` be *cast* to a `String[]` --
        // the caller's slot is a `String[]` and the emitter spells that cast.
        // The first version allocated `Object[]` and every case threw
        // `ClassCastException` at run time rather than refusing, which is the
        // one outcome this backend is supposed to make impossible.
        // **Two passes, because JavaScript's own-property order is not insertion
        // order.** Every key that is an array index comes first, *ascending*,
        // and the rest follow in insertion order. This walked once and wrote
        // each key as it came, which is the order the C runtime had until the
        // same fix landed there -- and `http`'s status table is
        // `{ 100: "Continue", 101: "Switching Protocols", ... }`, every key an
        // index, so any enumeration of it was wrong unless the insertions
        // happened to be ascending.
        //
        // It did not read as a defect on this lane because it is not a refusal:
        // `examples/object-key-order` lowered, emitted, ran, and disagreed with
        // node on 87 cases while the floor counted it as compiled.
        String[] out = new String[(int) size(map)];
        int written = 0;
        for (int slot = map.head; slot < map.used && written < out.length; slot++) {
            NtsValue key = map.keys[slot];
            if (key == null || indexKey((String) key.ref) < 0) {
                continue;
            }
            out[written++] = (String) key.ref;
        }
        // Insertion sort over the index keys alone. They are few in every table
        // this compiles -- a status table is the large case at sixty -- and the
        // value is re-derived rather than carried, because parsing ten digits
        // is cheaper than an allocation to hold them. The C says the same.
        int indices = written;
        for (int i = 1; i < indices; i++) {
            String held = out[i];
            long value = indexKey(held);
            int j = i;
            while (j > 0 && indexKey(out[j - 1]) > value) {
                out[j] = out[j - 1];
                j--;
            }
            out[j] = held;
        }
        for (int slot = map.head; slot < map.used && written < out.length; slot++) {
            NtsValue key = map.keys[slot];
            if (key == null || indexKey((String) key.ref) >= 0) {
                continue;
            }
            out[written++] = (String) key.ref;
        }
        return out;
    }

    /**
     * The array-index value of a key, or {@code -1} if it is not one.
     *
     * <p>A transliteration of `nts_array_index_key`, and the rule is narrower
     * than "looks numeric": the string must be the *canonical* decimal of a
     * value below 2^32-1. So {@code "0"} is an index and {@code "01"} is not,
     * {@code "-1"} is not, and {@code "4294967295"} is not -- that last is the
     * one a length check alone would let through.
     *
     * <p>Answers {@code -1} where the C takes an out-parameter and a
     * {@code bool}. An index can never be negative, so the two are the same
     * function and this one does not need the caller to hold a slot.
     */
    private static long indexKey(String key) {
        int units = key.length();
        if (units == 0 || units > 10) {
            return -1;
        }
        if (units > 1 && key.charAt(0) == '0') {
            return -1;
        }
        long value = 0;
        for (int at = 0; at < units; at++) {
            char unit = key.charAt(at);
            if (unit < '0' || unit > '9') {
                return -1;
            }
            value = value * 10 + (unit - '0');
        }
        return value >= 4294967295L ? -1 : value;
    }

    public static NtsMap copy(NtsMap from) {
        NtsMap out = new NtsMap(from.map);
        for (int slot = from.head; slot < from.used; slot++) {
            NtsValue key = from.keys[slot];
            if (key == null) {
                continue;
            }
            if (from.map) {
                set(out, key, from.values[slot]);
            } else {
                add(out, key);
            }
        }
        return out;
    }

    public static NtsValue get(NtsMap map, NtsValue key) {
        int at = map.find(key);
        return at < 0 ? NtsValue.UNDEFINED_VALUE : map.values[at];
    }

    public static boolean has(NtsMap map, NtsValue key) {
        return map.find(key) >= 0;
    }

    public static NtsMap set(NtsMap map, NtsValue key, NtsValue value) {
        if (key == null) { throw new NullPointerException("NtsValue key"); }
        long[] table = map.buckets;
        if (table.length == 0) {
            int existing = map.findLinear(key);
            if (existing >= 0) {
                map.values[existing] = value;
                return map;
            }
            map.reserveEntry();
            // Bound the historical scan as well as the live size.
            if (map.used - map.head < LINEAR_LIMIT) {
                map.append(key, value);
                return map;
            }
            map.rehash(16);
            table = map.buckets;
        }
        int h = hash(key);
        int mask = table.length - 1;
        int p = h & mask;
        long cell;
        while ((cell = table[p]) != 0L) {
            int slot = (int) cell - 1;
            if ((int) (cell >>> 32) == h && sameKey(map.keys[slot], key)) {
                map.values[slot] = value;
                return map;
            }
            p = (p + 1) & mask;
        }
        map.reserveEntry();
        if (map.count >= map.threshold) {
            if (table.length >= (1 << 30)) {
                throw new OutOfMemoryError("map index capacity exhausted");
            }
            map.rehash(table.length << 1);
            table = map.buckets;
            mask = table.length - 1;
            p = h & mask;
            while (table[p] != 0L) { p = (p + 1) & mask; }
        }
        // Prefix reclamation changes slots, not hash bucket positions.
        int slot = map.used;
        map.append(key, value);
        table[p] = cell(h, slot);
        return map;
    }

    public static NtsMap add(NtsMap map, NtsValue key) {
        // Set iteration must expose +0, not the -0 supplied by the caller.
        NtsValue canonical = canonicalKey(key);
        return set(map, canonical, canonical);
    }

    private void append(NtsValue key, NtsValue value) {
        keys[used] = canonicalKey(key);
        values[used] = value;
        used++;
        count++;
    }

    private static NtsValue canonicalKey(NtsValue key) {
        return key.tag == NtsValue.NUMBER && key.num == 0.0 ? ZERO_KEY : key;
    }

    private int find(NtsValue key) {
        if (key == null) { throw new NullPointerException("NtsValue key"); }
        if (count == 0) { return -1; }
        if (buckets.length == 0) { return findLinear(key); }
        int h = hash(key);
        int mask = buckets.length - 1;
        int p = h & mask;
        for (;;) {
            long cell = buckets[p];
            if (cell == 0L) { return -1; }
            int slot = (int) cell - 1;
            if ((int) (cell >>> 32) == h && sameKey(keys[slot], key)) {
                return slot;
            }
            p = (p + 1) & mask;
        }
    }

    private int findLinear(NtsValue key) {
        for (int i = head; i < used; i++) {
            NtsValue candidate = keys[i];
            if (candidate != null && sameKey(candidate, key)) { return i; }
        }
        return -1;
    }

    public static boolean delete(NtsMap map, NtsValue key) {
        if (key == null) { throw new NullPointerException("NtsValue key"); }
        if (map.count == 0) { return false; }
        int slot;
        if (map.buckets.length == 0) {
            slot = map.findLinear(key);
            if (slot < 0) { return false; }
        } else {
            int h = hash(key);
            int mask = map.buckets.length - 1;
            int p = h & mask;
            for (;;) {
                long cell = map.buckets[p];
                if (cell == 0L) { return false; }
                slot = (int) cell - 1;
                if ((int) (cell >>> 32) == h && sameKey(map.keys[slot], key)) { break; }
                p = (p + 1) & mask;
            }
            map.removeBucket(p);
        }
        map.keys[slot] = null;
        map.values[slot] = null;
        if (--map.count == 0) {
            map.base += map.used;
            map.used = map.head = 0;
        } else if (slot == map.head) {
            do { map.head++; } while (map.head < map.used && map.keys[map.head] == null);
        }
        return true;
    }

    /** Close the probe cluster: there are no accumulating index tombstones. */
    private void removeBucket(int hole) {
        int mask = buckets.length - 1;
        int scan = (hole + 1) & mask;
        long entry;
        while ((entry = buckets[scan]) != 0L) {
            int home = ((int) (entry >>> 32)) & mask;
            if (((scan - home) & mask) >= ((scan - hole) & mask)) {
                buckets[hole] = entry;
                hole = scan;
            }
            scan = (scan + 1) & mask;
        }
        buckets[hole] = 0L;
    }

    public static void clear(NtsMap map) {
        if (map.count == 0) { return; }
        Arrays.fill(map.keys, map.head, map.used, null);
        Arrays.fill(map.values, map.head, map.used, null);
        Arrays.fill(map.buckets, 0L);
        map.base += map.used;
        map.used = map.count = map.head = 0;
    }

    /** Next live absolute insertion position >= from; -1 when there is none. */
    public static double next(NtsMap map, double from) {
        if (map.count == 0) { return -1.0; }
        int absolute = from < 0.0 ? 0 : (int) from;
        int at = absolute <= map.base ? map.head : Math.max(map.head, absolute - map.base);
        while (at < map.used) {
            if (map.keys[at] != null) { return (double) map.base + at; }
            at++;
        }
        return -1.0;
    }

    /**
     * Every key as a `double`, in one pass, without the cursor protocol.
     *
     * <p>**6.5x, measured before this was written.** `Array.from(set)` lowers
     * to `nts_map_next` for a cursor and `nts_map_key_at` for the key, so a
     * 256-element set costs 512 static calls and index arithmetic per element.
     * Against the identical output from this:
     *
     * <pre>
     *   walked 918 ns    bulk 140 ns
     *   walked 918 ns    bulk 144 ns
     * </pre>
     *
     * <p>`benches/cases/array-from` spends about 1.84ms of its 2.09ms in that
     * walk -- 2000 rounds at 918ns -- against a reference at 986us, so the row
     * is mostly this and not code generation.
     *
     * <p>**It is unreachable until the lowering calls it**, because the loop is
     * emitted open-coded rather than as one helper, and that is `hir`'s to
     * change rather than this backend's. Filed with MainClaude with this
     * number. A helper waiting for its caller is the same shape `isMap` and
     * `isSet` were in an hour before their lowering landed.
     *
     * <p>**The caller must know the keys are numbers**, exactly as
     * `arrayIndexOfI` must know its array is a `double[]`. Reading `.num` off a
     * string key answers zero rather than refusing, which is why this is not a
     * general iteration primitive and should not become one.
     *
     * <p>Deletions are the whole risk and are tested: `next` steps over null
     * slots, so a bulk pass that did not would return holes or the wrong count.
     * Seven cases -- empty, single, dense, every-other-deleted, head advanced,
     * emptied and refilled, and five thousand past the linear limit -- agree
     * element for element with the walk.
     */
    public static int keysIntoDoubles(NtsMap map, double[] out) {
        int at = 0;
        for (int slot = map.head; slot < map.used && at < out.length; slot++) {
            NtsValue key = map.keys[slot];
            if (key == null) {
                continue;
            }
            // **A non-number key refuses rather than reading `.num`.**
            // `.num` on a string key is zero, and a table of zeroes is a wrong
            // answer that `typeof` agrees with all the way down -- the same
            // shape as `arrayElement` falling through to `undefined` for an
            // array kind it had no arm for. The caller is meant to have proved
            // the key type, exactly as `arrayIndexOfI`'s caller proves the
            // element type; this makes the failure of that proof loud.
            if (key.tag != NtsValue.NUMBER) {
                throw new NtsRefusal(
                    "a bulk numeric key read over a collection holding a key of tag "
                        + key.tag);
            }
            out[at++] = key.num;
        }
        return at;
    }

    /**
     * `next` and `keyAt` with an `int` cursor instead of an `f64`.
     *
     * <p>**3.05x, measured before either was written into a pass.** Identical
     * protocol -- two calls an element, the same bounds and null tests, the
     * same output element for element -- with only the cursor's representation
     * changed:
     *
     * <pre>
     *   walked (f64 cursor)      919 ns
     *   walkedInt (int cursor)   301 ns
     *   bulk (no protocol)       149 ns
     * </pre>
     *
     * <p>So the cursor being a `double` is **672 of the 770ns** that separates
     * the walk from a bulk pass: 87% of what removing the protocol entirely
     * would buy, for a change that keeps it.
     *
     * <p>`nts_map_next` is an `f64` in `hir::runtime` and must stay one -- that
     * table is the single answer about conversions for three backends. These
     * are the `arrayIndexOfI` treatment applied to a cursor: the same latitude
     * `intcall` already takes deciding a helper's answer is exact in an `int`.
     *
     * <p>**Waiting on the pass, which is the harder half.** `intcall` holds a
     * value as an `int` when *every* use converts it to an integral type, and a
     * cursor's uses are `+ 1.0` and being handed back to `next` -- neither is a
     * conversion, and the value flows in a cycle through the loop's block
     * parameter. That is the extension this file has predicted twice and nobody
     * has built.
     */
    public static int nextI(NtsMap map, int from) {
        if (map.count == 0) { return -1; }
        int absolute = from < 0 ? 0 : from;
        int at = absolute <= map.base ? map.head : Math.max(map.head, absolute - map.base);
        while (at < map.used) {
            if (map.keys[at] != null) { return map.base + at; }
            at++;
        }
        return -1;
    }

    public static NtsValue keyAtI(NtsMap map, int absolute) {
        if (absolute < map.base) { return NtsValue.UNDEFINED_VALUE; }
        int slot = absolute - map.base;
        if (slot >= map.used || map.keys[slot] == null) { return NtsValue.UNDEFINED_VALUE; }
        return map.keys[slot];
    }

    public static NtsValue keyAt(NtsMap map, double at) {
        int absolute = (int) at;
        if (absolute < map.base) { return NtsValue.UNDEFINED_VALUE; }
        int slot = absolute - map.base;
        if (slot >= map.used || map.keys[slot] == null) { return NtsValue.UNDEFINED_VALUE; }
        return map.keys[slot];
    }

    public static NtsValue valueAt(NtsMap map, double at) {
        int absolute = (int) at;
        if (absolute < map.base) { return NtsValue.UNDEFINED_VALUE; }
        int slot = absolute - map.base;
        if (slot >= map.used || map.keys[slot] == null) { return NtsValue.UNDEFINED_VALUE; }
        return map.values[slot];
    }

    private void reserveEntry() {
        // Keep every cursor within the original signed-int slot domain.
        if ((long) base + used >= MAX_ARRAY) {
            throw new OutOfMemoryError("map insertion cursor space exhausted");
        }
        if (used < keys.length) { return; }
        if (head > 0) {
            int removed = head;
            int retained = used - removed;
            System.arraycopy(keys, removed, keys, 0, retained);
            System.arraycopy(values, removed, values, 0, retained);
            Arrays.fill(keys, retained, used, null);
            Arrays.fill(values, retained, used, null);
            base += removed;
            used = retained;
            head = 0;
            for (int i = 0; i < buckets.length; i++) {
                long c = buckets[i];
                if (c != 0L) {
                    buckets[i] = (c & 0xffffffff00000000L) | (((int) c - removed) & 0xffffffffL);
                }
            }
            return;
        }
        int capacity = keys.length == 0 ? 4 : (int) Math.min((long) keys.length * 2, MAX_ARRAY);
        if (capacity <= used) { throw new OutOfMemoryError("map storage capacity exhausted"); }
        keys = Arrays.copyOf(keys, capacity);
        values = Arrays.copyOf(values, capacity);
    }

    private void rehash(int capacity) {
        long[] replacement = new long[capacity];
        int mask = capacity - 1;
        if (buckets.length == 0) {
            for (int slot = head; slot < used; slot++) {
                if (keys[slot] == null) { continue; }
                int h = hash(keys[slot]);
                int p = h & mask;
                while (replacement[p] != 0L) { p = (p + 1) & mask; }
                replacement[p] = cell(h, slot);
            }
        } else {
            for (long entry : buckets) {
                if (entry == 0L) { continue; }
                int p = ((int) (entry >>> 32)) & mask;
                while (replacement[p] != 0L) { p = (p + 1) & mask; }
                replacement[p] = entry;
            }
        }
        buckets = replacement;
        threshold = capacity - (capacity >>> 2); // 75%; always leave an empty bucket.
    }

    private static long cell(int hash, int slot) {
        return ((long) hash << 32) | ((slot + 1L) & 0xffffffffL);
    }

    private static boolean sameKey(NtsValue a, NtsValue b) {
        if (a == b) { return true; }
        if (a.tag != b.tag) { return false; }
        switch (a.tag) {
            case NtsValue.NUMBER:
                return a.num == b.num || (a.num != a.num && b.num != b.num);
            case NtsValue.BOOLEAN:
                return (a.num != 0.0) == (b.num != 0.0);
            case NtsValue.STRING:
                return a.ref == b.ref || a.ref.equals(b.ref);
            case NtsValue.UNDEFINED:
            case NtsValue.NULL:
                return true;
            default:
                return a.ref == b.ref;
        }
    }

    /**
     * The hash of a reference key, reached with or without an {@link NtsValue}
     * around it.
     *
     * <p>Called from {@link #hash}'s default arm and from {@link #findObject},
     * so the two cannot disagree -- which they would silently, as a lookup that
     * simply never finds anything.
     */
    private static int hashObject(Object ref) {
        int h = System.identityHashCode(ref);
        h *= 0x9e3779b1;
        return h ^ (h >>> 16);
    }

    /**
     * {@link #find}, for a key that has not been boxed.
     *
     * <p>Exactly {@code find(NtsValue.ofObject(key))} and nothing else:
     * {@code ofObject} tags a non-null reference {@code OBJECT}, {@code hash}
     * sends that tag to {@link #hashObject}, and {@code sameKey} reaches its
     * default arm -- {@code a.ref == b.ref} -- only once {@code a.tag != b.tag}
     * has ruled out every other tag. So the stored key matches when it is
     * tagged {@code OBJECT} and holds the same reference, and the box the
     * comparison would have been made through never has to exist.
     *
     * <p>A null key is not an {@code OBJECT} at all -- {@code ofObject(null)}
     * is {@code NULL_VALUE} -- so it delegates rather than being special-cased
     * wrongly.
     */
    private int findObject(Object key) {
        if (key == null) { return find(NtsValue.NULL_VALUE); }
        if (count == 0) { return -1; }
        if (buckets.length == 0) {
            for (int i = head; i < used; i++) {
                NtsValue candidate = keys[i];
                if (candidate != null && candidate.tag == NtsValue.OBJECT && candidate.ref == key) {
                    return i;
                }
            }
            return -1;
        }
        int h = hashObject(key);
        int mask = buckets.length - 1;
        int p = h & mask;
        for (;;) {
            long cell = buckets[p];
            if (cell == 0L) { return -1; }
            int slot = (int) cell - 1;
            NtsValue candidate = keys[slot];
            if ((int) (cell >>> 32) == h && candidate.tag == NtsValue.OBJECT && candidate.ref == key) {
                return slot;
            }
            p = (p + 1) & mask;
        }
    }

    /**
     * {@code m.get(k)} where {@code k} is a reference the caller holds unboxed.
     *
     * <p>**This is an ART optimisation and is worth nothing on HotSpot**, which
     * is the same shape as `fuse` and was measured the same way. `benches/cases/symbol-keyed-map`
     * looks a symbol up 8,192 times an operation, and each lookup built an
     * {@link NtsValue} purely to be compared through and discarded:
     *
     * <pre>
     * symbol-keyed-map    HotSpot 368    ART 196,912
     * </pre>
     *
     * and {@code 8192 * 24 = 196,608} of that is this box. C2 inlines the
     * helper and scalar-replaces the key; ART's escape analysis does not see
     * through the call boundary.
     */
    public static NtsValue getObject(NtsMap map, Object key) {
        int at = map.findObject(key);
        return at < 0 ? NtsValue.UNDEFINED_VALUE : map.values[at];
    }

    /** {@code m.has(k)} for an unboxed reference key; see {@link #getObject}. */
    public static boolean hasObject(NtsMap map, Object key) {
        return map.findObject(key) >= 0;
    }

    private static int hash(NtsValue value) {
        int h;
        switch (value.tag) {
            case NtsValue.NUMBER:
                long bits = Double.doubleToLongBits(value.num == 0.0 ? 0.0 : value.num);
                h = (int) (bits ^ (bits >>> 32));
                break;
            case NtsValue.BOOLEAN:
                h = value.num != 0.0 ? 1231 : 1237;
                break;
            case NtsValue.STRING:
                h = value.ref.hashCode() * 0x9e3779b9;
                return h ^ (h >>> 16);
            case NtsValue.UNDEFINED:
            case NtsValue.NULL:
                h = 0;
                break;
            default:
                // Returns rather than breaking to the mix below, because
                // `hashObject` applies it: one implementation, so a key looked
                // up without its box cannot hash differently from the same key
                // stored with one.
                return hashObject(value.ref);
        }
        // One multiply, and no tag mix. A profile of `map-and-set` put 20% of
        // the row in this method -- not from collisions, which were already
        // 1.43 probes against an ideal 1.00, but from its cost, against a
        // reference whose `Integer.hashCode` is `return value`.
        //
        // The tag does not need mixing in: `sameKey` separates a number from a
        // string that hashes the same, so the tag only has to affect
        // *distribution*, and in a table whose keys are all one tag it affects
        // nothing. Dropping it and one of the two multiplies measured **better**
        // spread, not worse -- 1.17 probes and 226 distinct low-9 bits against
        // 194 -- on integer keys, fractional keys and negative keys alike.
        h *= 0x9e3779b1;
        return h ^ (h >>> 16);
    }
}
