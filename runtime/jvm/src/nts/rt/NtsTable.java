package nts.rt;

import java.util.Arrays;

/**
 * Insertion-ordered SameValueZero table. The double-valued public ABI is unchanged.
 *
 * <p>The open-addressed index contains a cached hash and an insertion slot, not
 * boxed keys, boxed slots or HashMap nodes. Java null is not a valid NtsValue
 * (JS null is NtsValue.NULL_VALUE).
 *
 * <p>**Keys and values are each one column, and a number column holds bare
 * doubles.** A table the program types `Map<number, V>` or `Set<number>` keeps
 * its keys in {@link #numberKeys}, and a `Map<number, number>` its values in
 * {@link #numberValues}; every other table keeps {@link NtsValue} boxes in
 * {@link #keys} and {@link #values}, and exactly one of each pair is non-null.
 * The emitter picks the columns at construction from the table's static type
 * (`ops::table_constructor`), and its doors take a number key or value
 * unboxed (`fuse::unboxed_operands`). An erased box per entry was 62% of
 * `map-and-set`'s bytes, and a box built at the call site to pass a key was
 * allocated whether or not the table kept it: {@link #find} and
 * {@link #slotFor} do not inline into a hot loop, so it escaped into them.
 *
 * <p>**A number column is a storage choice, never a promise the table relies
 * on.** TypeScript's method bivariance lets a `Map<number, number>` be passed
 * as a `Map<unknown, unknown>` and handed a string, so the boxed entry points
 * take any key and value into any table: one that does not fit a number column
 * turns that column into boxes ({@link #eraseKeys}, {@link #eraseValues}),
 * once and for good, and each door falls back to its boxed form on a table
 * whose column is boxed. So no answer depends on which constructor ran.
 *
 * <p>A hole -- a deleted entry -- is a null key in a boxed key column, and a
 * set mark in {@link #dead} in a number one, which has no null to spare and
 * allocates the marks at its first deletion. A Set has no value column at
 * all -- neither {@link #values} nor {@link #numberValues} -- and its value is
 * its key.
 *
 * <p>**A boxed table pays nothing for the other layout.** Each test of the
 * layout reads the boxed column first, through the field the access then
 * loads anyway, so its null test is the one the array access makes: a first
 * version tested the number fields first, and `map-entries-top-k` ran at
 * 1.058 of main in a paired run, 1.001 with the boxed column read first.
 *
 * <p>**A door's cold path calls a real method directly, never a wrapper.**
 * The doors -- `getString`, `setString`, `getNumber` and the rest -- are
 * worth something only where C2 inlines them into the program's loop, and it
 * declines a callee whose own compiled code is past `InlineSmallCode`, 2,500
 * bytes. A method of 35 bytes or fewer (`MaxInlineSize`) inlines at any call
 * site however cold, and inside it its own call counts as hot as every call
 * to the wrapper, so a cold path through a small wrapper pulls everything
 * behind it into the door. `insertString`'s miss through such a wrapper
 * compiled `setString` to 5,232 bytes and `record-word-counts` ran at 1.032
 * of main. So a door stores once, into the slot it found or the one a direct
 * call to the slot method appends: `store(at >= 0 ? at : slotForString(k), v)`.
 * A door's C2 size is printed by `-XX:+LogCompilation` (`stub_offset` of its
 * `nmethod`), and a change to one says it.
 *
 * <p>Cursors are absolute insertion positions. base lets clear() and removal of
 * an all-dead prefix reuse storage without invalidating outstanding cursors.
 * Interior holes cannot be reused: a surviving old entry may precede them.
 * This collection, like the event loop, is confined to one execution thread.
 */
public abstract class NtsTable {
    private static final NtsValue[] EMPTY_VALUES = new NtsValue[0];
    private static final double[] EMPTY_NUMBERS = new double[0];
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

    /** The keys as boxes, or null where they are {@link #numberKeys}. */
    NtsValue[] keys;
    /** The keys as numbers, `-0` stored as `+0`, or null where they are {@link #keys}. */
    double[] numberKeys;
    /** The values as boxes, or null where they are {@link #numberValues} or this is a Set. */
    NtsValue[] values;
    /** The values as numbers, or null where they are {@link #values} or this is a Set. */
    double[] numberValues;
    /** A number key column's holes, one mark per slot; null until its first deletion. */
    private boolean[] dead;
    // Upper 32 bits: hash. Lower 32 bits: local slot + 1. Zero: empty.
    private long[] buckets = EMPTY_INDEX;
    int used;
    int count;
    int head;
    private int base;
    private int threshold;

    /** A Map's columns, or with {@code valued} false a Set's, which has no value column. */
    NtsTable(boolean numberKeys, boolean numberValues, boolean valued) {
        if (numberKeys) { this.numberKeys = EMPTY_NUMBERS; } else { this.keys = EMPTY_VALUES; }
        if (valued) {
            if (numberValues) { this.numberValues = EMPTY_NUMBERS; } else { this.values = EMPTY_VALUES; }
        }
    }

    public static double size(NtsTable map) { return map.count; }

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
    public static Object[] keysStr(NtsTable map) {
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


    public static NtsValue get(NtsTable map, NtsValue key) {
        return map.valueOrUndefined(map.find(key));
    }

    public static boolean has(NtsTable map, NtsValue key) {
        return map.find(key) >= 0;
    }

    static void insert(NtsTable map, NtsValue key, NtsValue value) {
        map.store(map.slotFor(key), value);
    }

    /**
     * The value at {@code at}, or undefined where {@code at} is -1.
     *
     * <p>**A number column's answer is built at one site**, its fields chosen
     * first. Where a hot caller reads the answer straight back -- its tag for
     * `?? 0`, its number -- C2 inlines this and takes the box apart, and it
     * does so only for an allocation nothing merges with: returning
     * `UNDEFINED_VALUE` on one arm and a new box on the other is a merge, and
     * HotSpot 21 kept every such box, 4,608 bytes an operation in a probe of
     * 192 reads where this shape measured zero. The boxed columns return what
     * they hold, as before.
     *
     * <p>**Under 35 bytes of bytecode, with the number arm a method of its
     * own**, as {@link #store} is. 35 is `MaxInlineSize`, what C2 inlines at a
     * call site that is not hot, and the door this replaced was 23 bytes, so
     * a boxed read inlines wherever it did. Measured neutral on the five
     * table rows, which read at hot sites; what had cost `record-word-counts`
     * was {@link #insertString}'s miss path.
     */
    private NtsValue valueOrUndefined(int at) {
        NtsValue[] boxes = values;
        if (boxes == null) { return unboxedValueOrUndefined(at); }
        return at < 0 ? NtsValue.UNDEFINED_VALUE : boxes[at];
    }

    /** {@link #valueOrUndefined} for a number value column, or a Set's, whose value is its key. */
    private NtsValue unboxedValueOrUndefined(int at) {
        double[] numbers = numberValues;
        if (numbers == null) { return keyOrUndefined(at); }
        boolean found = at >= 0;
        return NtsValue.numberOrUndefined(found, found ? numbers[at] : 0.0);
    }

    /** The key at {@code at}, or undefined where {@code at} is -1; see {@link #valueOrUndefined}. */
    private NtsValue keyOrUndefined(int at) {
        NtsValue[] boxes = keys;
        if (boxes == null) { return numberKeyOrUndefined(at); }
        return at < 0 ? NtsValue.UNDEFINED_VALUE : boxes[at];
    }

    private NtsValue numberKeyOrUndefined(int at) {
        boolean found = at >= 0;
        return NtsValue.numberOrUndefined(found, found ? numberKeys[at] : 0.0);
    }

    /**
     * The slot holding {@code key}, appended where there is none.
     *
     * <p>An appended slot's value is unwritten: every caller stores one with
     * {@link #store} or {@link #storeNumber}, which is the other half of a
     * `set`, and which a Set ignores. A key that is not a number turns a number
     * key column into boxes first.
     */
    int slotFor(NtsValue key) {
        if (key == null) { throw new NullPointerException("NtsValue key"); }
        if (keys == null) {
            if (key.tag == NtsValue.NUMBER) { return slotForNumber(key.num); }
            eraseKeys();
        }
        long[] table = buckets;
        if (table.length == 0) {
            int existing = findLinear(key);
            if (existing >= 0) { return existing; }
            reserveEntry();
            // Bound the historical scan as well as the live size.
            if (used - head < LINEAR_LIMIT) { return append(key); }
            rehash(16);
            table = buckets;
        }
        int h = hash(key);
        int mask = table.length - 1;
        int p = h & mask;
        long cell;
        while ((cell = table[p]) != 0L) {
            int slot = (int) cell - 1;
            if ((int) (cell >>> 32) == h && sameKey(keys[slot], key)) { return slot; }
            p = (p + 1) & mask;
        }
        reserveEntry();
        p = growIndex(h, p);
        // Prefix reclamation changes slots, not hash bucket positions.
        int slot = append(key);
        buckets[p] = cell(h, slot);
        return slot;
    }

    /** {@link #slotFor} for a number key, unboxed. */
    int slotForNumber(double key) {
        if (numberKeys == null) { return slotFor(NtsValue.ofNumber(key)); }
        long[] table = buckets;
        if (table.length == 0) {
            int found = slotForNumberUnindexed(key);
            if (found >= 0) { return found; }
            table = buckets;
        }
        int h = hashNumber(key);
        int mask = table.length - 1;
        int p = h & mask;
        long cell;
        while ((cell = table[p]) != 0L) {
            int slot = (int) cell - 1;
            if ((int) (cell >>> 32) == h && sameNumber(numberKeys[slot], key)) { return slot; }
            p = (p + 1) & mask;
        }
        reserveEntry();
        p = growIndex(h, p);
        int slot = appendNumber(key);
        buckets[p] = cell(h, slot);
        return slot;
    }

    /**
     * {@link #slotForNumber} while the table has no index: the slot the scan
     * finds or appends, or -1 when this append is the one that built the
     * index, which the caller then probes.
     *
     * <p>A method of its own so the door carries one probe: inlined, this
     * scan brought a whole {@link #findNumber} into `setNumber`, which
     * compiled to 2,416 bytes beside `InlineSmallCode`'s 2,500. Whichever
     * half a program's tables keep hot -- this one under the linear limit,
     * the index above it -- is the half C2 inlines.
     */
    private int slotForNumberUnindexed(double key) {
        int existing = findNumber(key);
        if (existing >= 0) { return existing; }
        reserveEntry();
        if (used - head < LINEAR_LIMIT) { return appendNumber(key); }
        rehash(16);
        return -1;
    }

    /**
     * The empty bucket at {@code p} for an entry of hash {@code h} about to be
     * appended, or the one it moves to when the index first grows.
     */
    private int growIndex(int h, int p) {
        if (count < threshold) { return p; }
        if (buckets.length >= (1 << 30)) {
            throw new OutOfMemoryError("map index capacity exhausted");
        }
        rehash(buckets.length << 1);
        int mask = buckets.length - 1;
        p = h & mask;
        while (buckets[p] != 0L) { p = (p + 1) & mask; }
        return p;
    }

    private int append(NtsValue key) {
        keys[used] = canonicalKey(key);
        count++;
        return used++;
    }

    private int appendNumber(double key) {
        numberKeys[used] = key == 0.0 ? 0.0 : key;
        // A slot past `used` may carry a mark from an entry deleted before
        // the table emptied or was cleared; the append is what clears it.
        if (dead != null) { dead[used] = false; }
        count++;
        return used++;
    }

    /**
     * Store the value of a `set` in {@code slot}. Small enough to inline at any
     * call site, as {@link #valueOrUndefined} is, so the boxed column costs
     * what it did before there was another.
     */
    void store(int slot, NtsValue value) {
        NtsValue[] boxes = values;
        if (boxes == null) {
            storeUnboxed(slot, value);
            return;
        }
        boxes[slot] = value;
    }

    /** {@link #store} into a number value column, which a value that is not a number turns into boxes, or a Set's none. */
    private void storeUnboxed(int slot, NtsValue value) {
        if (numberValues == null) { return; }
        if (value.tag != NtsValue.NUMBER) {
            eraseValues();
            values[slot] = value;
            return;
        }
        numberValues[slot] = value.num;
    }

    /** {@link #store} for a number value, unboxed. */
    void storeNumber(int slot, double value) {
        if (numberValues != null) {
            numberValues[slot] = value;
        } else if (values != null) {
            values[slot] = NtsValue.ofNumber(value);
        }
    }

    /** The number key column as boxes, for a key that is not a number. */
    private void eraseKeys() {
        double[] numbers = numberKeys;
        NtsValue[] boxes = new NtsValue[numbers.length];
        for (int slot = head; slot < used; slot++) {
            if (!hole(slot)) { boxes[slot] = NtsValue.ofNumber(numbers[slot]); }
        }
        keys = boxes;
        numberKeys = null;
        dead = null;
    }

    /** The number value column as boxes, for a value that is not a number. */
    private void eraseValues() {
        double[] numbers = numberValues;
        NtsValue[] boxes = new NtsValue[numbers.length];
        for (int slot = head; slot < used; slot++) {
            if (!hole(slot)) { boxes[slot] = NtsValue.ofNumber(numbers[slot]); }
        }
        values = boxes;
        numberValues = null;
    }

    /** Whether {@code slot}, below {@code used}, is a deleted entry's. */
    private boolean hole(int slot) {
        NtsValue[] boxes = keys;
        return boxes != null ? boxes[slot] == null : dead != null && dead[slot];
    }

    private int capacity() {
        NtsValue[] boxes = keys;
        return boxes != null ? boxes.length : numberKeys.length;
    }

    /** The hash of the key in {@code slot}, from whichever column holds it. */
    private int slotHash(int slot) {
        NtsValue[] boxes = keys;
        return boxes != null ? hash(boxes[slot]) : hashNumber(numberKeys[slot]);
    }

    /**
     * Every live entry of {@code from} set into {@code into}, in entry order,
     * each column read as it is held: what `copy` and `extend` do, for any two
     * column layouts.
     */
    static void copyEntries(NtsTable from, NtsTable into) {
        for (int slot = from.head; slot < from.used; slot++) {
            if (from.hole(slot)) { continue; }
            int at = from.keys != null
                ? into.slotFor(from.keys[slot])
                : into.slotForNumber(from.numberKeys[slot]);
            if (from.numberValues != null) {
                into.storeNumber(at, from.numberValues[slot]);
            } else if (from.values != null) {
                into.store(at, from.values[slot]);
            }
        }
    }

    static NtsValue canonicalKey(NtsValue key) {
        return key.tag == NtsValue.NUMBER && key.num == 0.0 ? ZERO_KEY : key;
    }

    private int find(NtsValue key) {
        if (key == null) { throw new NullPointerException("NtsValue key"); }
        if (keys == null) { return key.tag == NtsValue.NUMBER ? findNumber(key.num) : -1; }
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

    /**
     * {@link #find} in a number key column, for a key that has not been boxed.
     *
     * <p>A deleted slot keeps its number, so the scan asks {@link #hole} of a
     * match; the index drops a deleted slot's bucket and needs no such test.
     */
    private int findNumber(double key) {
        if (count == 0) { return -1; }
        double[] column = numberKeys;
        if (buckets.length == 0) { return findNumberUnindexed(key, column); }
        int h = hashNumber(key);
        int mask = buckets.length - 1;
        int p = h & mask;
        for (;;) {
            long cell = buckets[p];
            if (cell == 0L) { return -1; }
            int slot = (int) cell - 1;
            if ((int) (cell >>> 32) == h && sameNumber(column[slot], key)) { return slot; }
            p = (p + 1) & mask;
        }
    }

    /** {@link #findNumber} before the table has an index; see {@link #findStringUnindexed}. */
    private int findNumberUnindexed(double key, double[] column) {
        for (int i = head; i < used; i++) {
            if (sameNumber(column[i], key) && !hole(i)) { return i; }
        }
        return -1;
    }

    /** The slot of a number key in any table: unboxed in a number key column, boxed in another. */
    int findNumberKey(double key) {
        return keys == null ? findNumber(key) : find(NtsValue.ofNumber(key));
    }

    public static boolean delete(NtsTable map, NtsValue key) {
        return map.remove(map.find(key));
    }

    /** Delete the entry at {@code slot}, answering whether there was one: false for -1. */
    private boolean remove(int slot) {
        if (slot < 0) { return false; }
        if (buckets.length != 0) { unlink(slot); }
        if (keys != null) {
            keys[slot] = null;
        } else {
            if (dead == null) { dead = new boolean[numberKeys.length]; }
            dead[slot] = true;
        }
        if (values != null) { values[slot] = null; }
        if (--count == 0) {
            base += used;
            used = head = 0;
        } else if (slot == head) {
            do { head++; } while (head < used && hole(head));
        }
        return true;
    }

    /** Drop the bucket that indexes {@code slot}, found by its key's hash. */
    private void unlink(int slot) {
        int mask = buckets.length - 1;
        int p = slotHash(slot) & mask;
        long indexed = slot + 1L;
        while ((buckets[p] & 0xffffffffL) != indexed) { p = (p + 1) & mask; }
        removeBucket(p);
    }

    /** {@code m.get(k)} for a number key, unboxed; see {@link #valueOrUndefined} for the answer. */
    public static NtsValue getNumber(NtsTable map, double key) {
        return map.valueOrUndefined(map.findNumberKey(key));
    }

    /** {@code m.has(k)} for a number key, unboxed. */
    public static boolean hasNumber(NtsTable map, double key) {
        return map.findNumberKey(key) >= 0;
    }

    /** {@code m.delete(k)} for a number key, unboxed. */
    public static boolean deleteNumber(NtsTable map, double key) {
        return map.remove(map.findNumberKey(key));
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

    public static void clear(NtsTable map) {
        if (map.count == 0) { return; }
        // A number column's slots and marks need no clearing: an append
        // writes its key and clears its mark.
        if (map.keys != null) { Arrays.fill(map.keys, map.head, map.used, null); }
        if (map.values != null) { Arrays.fill(map.values, map.head, map.used, null); }
        Arrays.fill(map.buckets, 0L);
        map.base += map.used;
        map.used = map.count = map.head = 0;
    }

    /**
     * `nts_map_keys_into` and `nts_map_values_into`: a table's live keys or
     * values, in entry order and skipping holes, into the array the middle end
     * allocated just before them with the table's live count. One overload per
     * array the JVM holds -- bare `double[]`, `boolean[]`, a reference array, or
     * an `NtsValue[]` of erased elements, and each growable wrapper's storage --
     * chosen by the destination's type (`ops::table_fill_external`).
     *
     * <p>**6.5x, measured before this was reachable.** `Array.from(set)` walked
     * the table through `nts_map_next` for a cursor and `nts_map_key_at` for the
     * key, two static calls and index arithmetic per element:
     *
     * <pre>
     *   walked 918 ns    bulk 140 ns
     *   walked 918 ns    bulk 144 ns
     * </pre>
     *
     * <p>Core emits the fill only where the array's element type is the
     * table's stored key or value type, so each copy only unboxes: `.num` for a
     * number, `.num != 0` for a boolean, `.ref` for a reference, and the box
     * itself for an erased element. A copy that finds an entry of another tag
     * refuses rather than reading the field anyway -- `.num` on a string is
     * zero, and a table of zeroes is a wrong answer `typeof` agrees with all
     * the way down -- so a broken proof is loud, at one compare per element.
     *
     * <p>A hole is a deleted key's slot, for the value as well. A number
     * column with none between `head` and `used` -- a table nothing was
     * deleted from -- is one `arraycopy`, as Wasm's fill is one `array.copy`.
     */
    public static void keysInto(NtsTable map, double[] out) { numbersInto(map, map.numberKeys, map.keys, out); }
    public static void valuesInto(NtsTable map, double[] out) { numbersInto(map, map.valueNumbers(), map.valueBoxes(), out); }
    public static void keysInto(NtsTable map, NtsArrayD out) { numbersInto(map, map.numberKeys, map.keys, out.items); }
    public static void valuesInto(NtsTable map, NtsArrayD out) { numbersInto(map, map.valueNumbers(), map.valueBoxes(), out.items); }
    public static void keysInto(NtsTable map, boolean[] out) { booleansInto(map, map.numberKeys, map.keys, out); }
    public static void valuesInto(NtsTable map, boolean[] out) { booleansInto(map, map.valueNumbers(), map.valueBoxes(), out); }
    public static void keysInto(NtsTable map, NtsArrayZ out) { booleansInto(map, map.numberKeys, map.keys, out.items); }
    public static void valuesInto(NtsTable map, NtsArrayZ out) { booleansInto(map, map.valueNumbers(), map.valueBoxes(), out.items); }
    /** A reference array of any class: an element the table holds is of it. */
    public static void keysInto(NtsTable map, Object[] out) { referencesInto(map, map.numberKeys, map.keys, out); }
    public static void valuesInto(NtsTable map, Object[] out) { referencesInto(map, map.valueNumbers(), map.valueBoxes(), out); }
    public static void keysInto(NtsTable map, NtsArrayL out) { referencesInto(map, map.numberKeys, map.keys, out.items); }
    public static void valuesInto(NtsTable map, NtsArrayL out) { referencesInto(map, map.valueNumbers(), map.valueBoxes(), out.items); }
    /** Erased elements: the boxes themselves, `-0` already stored as `+0`. */
    public static void keysIntoErased(NtsTable map, NtsValue[] out) { boxesInto(map, map.numberKeys, map.keys, out); }
    public static void valuesIntoErased(NtsTable map, NtsValue[] out) { boxesInto(map, map.valueNumbers(), map.valueBoxes(), out); }
    public static void keysIntoErased(NtsTable map, NtsArrayL out) { boxesInto(map, map.numberKeys, map.keys, out.items); }
    public static void valuesIntoErased(NtsTable map, NtsArrayL out) { boxesInto(map, map.valueNumbers(), map.valueBoxes(), out.items); }

    /** Whether this has a value column: a Set has none, and its values are its keys. */
    private boolean valued() { return values != null || numberValues != null; }

    /** The value column as numbers, or null; a Set's values are its keys. */
    private double[] valueNumbers() { return valued() ? numberValues : numberKeys; }

    /** The value column as boxes, or null; a Set's values are its keys. */
    private NtsValue[] valueBoxes() { return valued() ? values : keys; }

    /** Each copy below takes a column both ways, as numbers or as boxes, exactly one of them non-null. */
    private static void numbersInto(NtsTable map, double[] numbers, NtsValue[] boxes, double[] out) {
        if (numbers != null) {
            if (map.count == map.used - map.head) {
                System.arraycopy(numbers, map.head, out, 0, Math.min(map.count, out.length));
                return;
            }
            int at = 0;
            for (int slot = map.head; slot < map.used && at < out.length; slot++) {
                if (!map.hole(slot)) { out[at++] = numbers[slot]; }
            }
            return;
        }
        int at = 0;
        for (int slot = map.head; slot < map.used && at < out.length; slot++) {
            if (map.hole(slot)) { continue; }
            NtsValue part = boxes[slot];
            if (part.tag != NtsValue.NUMBER) { throw misread("numeric", part.tag); }
            out[at++] = part.num;
        }
    }

    private static void booleansInto(NtsTable map, double[] numbers, NtsValue[] boxes, boolean[] out) {
        if (numbers != null) {
            if (map.count > 0) { throw misread("boolean", NtsValue.NUMBER); }
            return;
        }
        int at = 0;
        for (int slot = map.head; slot < map.used && at < out.length; slot++) {
            if (map.hole(slot)) { continue; }
            NtsValue part = boxes[slot];
            if (part.tag != NtsValue.BOOLEAN) { throw misread("boolean", part.tag); }
            out[at++] = part.num != 0.0;
        }
    }

    /**
     * A null or undefined entry is the null reference, as a reference element
     * holds either; a number or a boolean has no reference to copy.
     */
    private static void referencesInto(NtsTable map, double[] numbers, NtsValue[] boxes, Object[] out) {
        if (numbers != null) {
            if (map.count > 0) { throw misread("reference", NtsValue.NUMBER); }
            return;
        }
        int at = 0;
        for (int slot = map.head; slot < map.used && at < out.length; slot++) {
            if (map.hole(slot)) { continue; }
            NtsValue part = boxes[slot];
            if (part.tag == NtsValue.NUMBER || part.tag == NtsValue.BOOLEAN) { throw misread("reference", part.tag); }
            out[at++] = part.ref;
        }
    }

    private static void boxesInto(NtsTable map, double[] numbers, NtsValue[] boxes, Object[] out) {
        int at = 0;
        for (int slot = map.head; slot < map.used && at < out.length; slot++) {
            if (map.hole(slot)) { continue; }
            out[at++] = numbers != null ? NtsValue.ofNumber(numbers[slot]) : boxes[slot];
        }
    }

    private static NtsRefusal misread(String width, int tag) {
        return new NtsRefusal("a bulk " + width + " read over a collection holding an entry of tag " + tag);
    }

    /**
     * Next live absolute insertion position at or after {@code from}, or -1
     * for a negative start or an exhausted walk. Clear and prefix reclamation
     * advance {@code base}, so a saved cursor keeps its insertion identity.
     * The absolute cursor space is bounded by {@code MAX_ARRAY}; its end has
     * room for the caller's int32 {@code cursor + 1}.
     */
    public static int nextI(NtsTable map, int from) {
        if (from < 0 || map.count == 0) { return -1; }
        int at = from <= map.base ? map.head : Math.max(map.head, from - map.base);
        while (at < map.used) {
            if (!map.hole(at)) { return map.base + at; }
            at++;
        }
        return -1;
    }

    /** Read the key at a live absolute cursor, or undefined if it is dead. */
    public static NtsValue keyAtI(NtsTable map, int absolute) {
        return map.keyOrUndefined(map.liveSlot(absolute));
    }

    /** Read the value at a live absolute cursor, or undefined if it is dead. */
    public static NtsValue valueAtI(NtsTable map, int absolute) {
        return map.valueOrUndefined(map.liveSlot(absolute));
    }

    /** The slot of a live absolute cursor, or -1 for a dead one. */
    private int liveSlot(int absolute) {
        if (absolute < base) { return -1; }
        int slot = absolute - base;
        return slot < used && !hole(slot) ? slot : -1;
    }

    private void reserveEntry() {
        // Bound absolute insertion positions, including slots retired by clear
        // and compaction. This platform cap is below core NTS_MAX_LENGTH;
        // exhausting it keeps the existing host allocation-failure path.
        if ((long) base + used >= MAX_ARRAY) {
            throw new OutOfMemoryError("map insertion cursor space exhausted");
        }
        if (used < capacity()) { return; }
        if (head > 0) {
            int removed = head;
            int retained = used - removed;
            if (keys != null) {
                System.arraycopy(keys, removed, keys, 0, retained);
                Arrays.fill(keys, retained, used, null);
            } else {
                System.arraycopy(numberKeys, removed, numberKeys, 0, retained);
                if (dead != null) { System.arraycopy(dead, removed, dead, 0, retained); }
            }
            if (values != null) {
                System.arraycopy(values, removed, values, 0, retained);
                Arrays.fill(values, retained, used, null);
            } else if (numberValues != null) {
                System.arraycopy(numberValues, removed, numberValues, 0, retained);
            }
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
        int now = capacity();
        int capacity = now == 0 ? 4 : (int) Math.min((long) now * 2, MAX_ARRAY);
        if (capacity <= used) { throw new OutOfMemoryError("map storage capacity exhausted"); }
        if (keys != null) { keys = Arrays.copyOf(keys, capacity); }
        else { numberKeys = Arrays.copyOf(numberKeys, capacity); }
        if (dead != null) { dead = Arrays.copyOf(dead, capacity); }
        if (values != null) { values = Arrays.copyOf(values, capacity); }
        else if (numberValues != null) { numberValues = Arrays.copyOf(numberValues, capacity); }
    }

    private void rehash(int capacity) {
        long[] replacement = new long[capacity];
        int mask = capacity - 1;
        if (buckets.length == 0) {
            for (int slot = head; slot < used; slot++) {
                if (hole(slot)) { continue; }
                int h = slotHash(slot);
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

    static boolean sameKey(NtsValue a, NtsValue b) {
        if (a == b) { return true; }
        if (a.tag != b.tag) { return false; }
        switch (a.tag) {
            case NtsValue.NUMBER:
                return sameNumber(a.num, b.num);
            case NtsValue.BOOLEAN:
                return (a.num != 0.0) == (b.num != 0.0);
            case NtsValue.STRING:
                return a.ref == b.ref || a.ref.equals(b.ref);
            case NtsValue.BIGINT:
                return NtsBigInt.eq((NtsBigInt) a.ref, (NtsBigInt) b.ref);
            case NtsValue.UNDEFINED:
            case NtsValue.NULL:
                return true;
            default:
                return a.ref == b.ref;
        }
    }

    /**
     * SameValueZero between two numbers: `NaN` is one key, whatever its bits,
     * and `-0` is `+0`, which `==` already says.
     */
    private static boolean sameNumber(double a, double b) {
        return a == b || (a != a && b != b);
    }

    /**
     * The hash of a number key, boxed or not: {@link #hash} sends a `NUMBER`
     * here, so a key stored unboxed and looked up boxed -- or a column turned
     * into boxes under its index -- hashes alike. `doubleToLongBits` answers
     * one pattern for every `NaN`, as {@link #sameNumber} makes them one key,
     * and `-0` hashes as `+0`.
     */
    private static int hashNumber(double key) {
        long bits = Double.doubleToLongBits(key == 0.0 ? 0.0 : key);
        return mix((int) (bits ^ (bits >>> 32)));
    }

    /**
     * One multiply, and no tag mix. A profile of `map-and-set` put 20% of the
     * row in hashing -- not from collisions, which were already 1.43 probes
     * against an ideal 1.00, but from its cost, against a reference whose
     * `Integer.hashCode` is `return value`.
     *
     * <p>The tag does not need mixing in: `sameKey` separates a number from a
     * string that hashes the same, so the tag only has to affect
     * *distribution*, and in a table whose keys are all one tag it affects
     * nothing. Dropping it and one of the two multiplies measured **better**
     * spread, not worse -- 1.17 probes and 226 distinct low-9 bits against
     * 194 -- on integer keys, fractional keys and negative keys alike.
     */
    private static int mix(int h) {
        h *= 0x9e3779b1;
        return h ^ (h >>> 16);
    }

    /**
     * The hash of a reference key, reached with or without an {@link NtsValue}
     * around it.
     *
     * <p>Called from {@link #hash}'s default arm and from {@link #findObject},
     * so the two cannot disagree -- which they would silently, as a lookup that
     * simply never finds anything.
     */
    /**
     * The tags {@link #sameKey} compares by reference identity, which is its
     * `default` arm and therefore everything it does not name.
     *
     * <p>**Written as the complement rather than as a list**, so that a tag
     * added to `sameKey`'s switch and not to this one is a compile-time
     * difference in one place rather than a silent disagreement in two. The two
     * are one rule and were two: `findObject` and its unboxed sibling both
     * tested `candidate.tag == OBJECT` directly.
     *
     * <p>That held for exactly as long as `OBJECT` was the only reference tag an
     * erased key could carry. `hir::tags::of_reference` gained a
     * `ManagedType::Symbol` arm on 2026-09-12, so a symbol key became
     * `SYMBOL`-tagged, and a lookup by bare reference stopped finding one it had
     * itself stored -- `twoSymbolsAreTwoKeys` and `aMixedKeyMap` in
     * `examples/symbol-values`. Hashing was already right, because `hash`'s own
     * default arm calls `hashObject` for the same reason this exists.
     */
    private static boolean keyedByIdentity(int tag) {
        switch (tag) {
            case NtsValue.NUMBER:
            case NtsValue.BOOLEAN:
            case NtsValue.STRING:
            case NtsValue.BIGINT:
            case NtsValue.UNDEFINED:
            case NtsValue.NULL:
                return false;
            default:
                return true;
        }
    }

    private static int hashObject(Object ref) {
        // A bigint is a value: two equal ones from two computations are one
        // key, and `hash`'s default arm sends tag 16 here, so a typed lookup by
        // bare reference and a boxed one hash alike.
        int h = ref instanceof NtsBigInt
            ? Long.hashCode(((NtsBigInt) ref).hi) * 31 + Long.hashCode(((NtsBigInt) ref).lo)
            : System.identityHashCode(ref);
        return mix(h);
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
        if (key instanceof NtsBigInt) { return find(NtsValue.ofBigInt((NtsBigInt) key)); }
        // A number key column holds nothing else.
        NtsValue[] column = keys;
        if (count == 0 || column == null) { return -1; }
        if (buckets.length == 0) { return findObjectUnindexed(key, column); }
        int h = hashObject(key);
        int mask = buckets.length - 1;
        int p = h & mask;
        for (;;) {
            long cell = buckets[p];
            if (cell == 0L) { return -1; }
            int slot = (int) cell - 1;
            NtsValue candidate = column[slot];
            if ((int) (cell >>> 32) == h && keyedByIdentity(candidate.tag) && candidate.ref == key) {
                return slot;
            }
            p = (p + 1) & mask;
        }
    }

    /** {@link #findObject} before the table has an index; see {@link #findStringUnindexed}. */
    private int findObjectUnindexed(Object key, NtsValue[] column) {
        for (int i = head; i < used; i++) {
            NtsValue candidate = column[i];
            if (candidate != null && keyedByIdentity(candidate.tag) && candidate.ref == key) {
                return i;
            }
        }
        return -1;
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
    public static NtsValue getObject(NtsTable map, Object key) {
        return map.valueOrUndefined(map.findObject(key));
    }

    /** {@code m.has(k)} for an unboxed reference key; see {@link #getObject}. */
    public static boolean hasObject(NtsTable map, Object key) {
        return map.findObject(key) >= 0;
    }

    /**
     * The hash of a string key, reached with or without an {@link NtsValue}
     * around it: {@link #hash}'s `STRING` arm and {@link #findString} both call
     * it, so a key looked up unboxed cannot hash differently from the same key
     * stored boxed. `String` caches its own `hashCode`. An `Object`, because
     * a `STRING` box holds its `ref` as one and `hash` should not cast it.
     */
    private static int hashString(Object key) {
        int h = key.hashCode() * 0x9e3779b9;
        return h ^ (h >>> 16);
    }

    /**
     * {@link #find}, for a string key that has not been boxed.
     *
     * <p>Exactly {@code find(NtsValue.ofString(key))}: {@code ofString} tags a
     * non-null string {@code STRING}, {@code hash} sends that tag to
     * {@link #hashString}, and {@code sameKey} compares two {@code STRING} keys
     * by {@code equals}. So the stored key matches when it is tagged
     * {@code STRING} and holds an equal string -- by contents, which is why this
     * is not {@link #findObject}: a key built at run time is the same key as an
     * equal literal without being the same reference. A null key is
     * {@code NULL_VALUE} to {@code ofString}, so it delegates.
     */
    int findString(String key) {
        if (key == null) { return find(NtsValue.NULL_VALUE); }
        // A number key column holds nothing else.
        NtsValue[] column = keys;
        if (count == 0 || column == null) { return -1; }
        if (buckets.length == 0) { return findStringUnindexed(key, column); }
        int h = hashString(key);
        int mask = buckets.length - 1;
        int p = h & mask;
        for (;;) {
            long cell = buckets[p];
            if (cell == 0L) { return -1; }
            int slot = (int) cell - 1;
            NtsValue candidate = column[slot];
            if ((int) (cell >>> 32) == h && candidate.tag == NtsValue.STRING
                    && (candidate.ref == key || candidate.ref.equals(key))) {
                return slot;
            }
            p = (p + 1) & mask;
        }
    }

    /**
     * {@link #findString} before the table has an index: a scan of the slots.
     * Apart from the probe so a door inlines only the half its table keeps
     * hot (the class doc).
     */
    private int findStringUnindexed(String key, NtsValue[] column) {
        for (int i = head; i < used; i++) {
            NtsValue candidate = column[i];
            if (candidate != null && candidate.tag == NtsValue.STRING
                    && (candidate.ref == key || candidate.ref.equals(key))) {
                return i;
            }
        }
        return -1;
    }

    /**
     * {@code m.get(k)} where {@code k} is a string the caller holds unboxed.
     *
     * <p>**This one is worth something on HotSpot**, unlike {@link #getObject}.
     * C2 scalar-replaces a key box only where the lookup inlines, and
     * {@link #find} and {@link #insert} are "already compiled into a big
     * method" where a hot loop calls them: `benchmarks/cases/record-word-counts`
     * built 1,600 boxes a run, about 38 KB of its 70,768 bytes against the
     * Java reference's 15,408. See `fuse::unboxed_keys`.
     */
    public static NtsValue getString(NtsTable map, String key) {
        return map.valueOrUndefined(map.findString(key));
    }

    /** {@code m.has(k)} for an unboxed string key; see {@link #getString}. */
    public static boolean hasString(NtsTable map, String key) {
        return map.findString(key) >= 0;
    }

    /**
     * {@code m.set(k, v)} for an unboxed string key: in place where the key is
     * there, and through {@link #insert} with the key boxed where it is not --
     * the one case the box is kept, as the stored key.
     */
    static void insertString(NtsTable map, String key, NtsValue value) {
        int at = map.findString(key);
        // **A cold path calls a real method directly** (the class doc): one
        // store, into the slot found or the one `slotForString` appends. A
        // string probe is too large to carry twice, so the door finds, and
        // only a miss -- rare where a table counts -- calls the append. Through
        // `insert`, a wrapper, C2 took all of `slotFor` in: `setString`
        // compiled to 5,232 bytes against `InlineSmallCode`'s 2,500, and
        // `record-word-counts` ran at 1.032 of main, 19 rounds in 20.
        map.store(at >= 0 ? at : map.slotForString(key), value);
    }

    /** {@link #insertString} for a number value, unboxed: the door is the same shape. */
    static void insertString(NtsTable map, String key, double value) {
        int at = map.findString(key);
        map.storeNumber(at >= 0 ? at : map.slotForString(key), value);
    }

    /**
     * {@link #slotFor} for a string key, unboxed: {@link #findString}'s probe,
     * and the key boxed only when it is appended. {@link #insertString}'s
     * miss, which is why it is a method of its own.
     */
    int slotForString(String key) {
        if (key == null || keys == null) { return slotFor(NtsValue.ofString(key)); }
        long[] table = buckets;
        if (table.length == 0) {
            int existing = findString(key);
            if (existing >= 0) { return existing; }
            reserveEntry();
            if (used - head < LINEAR_LIMIT) { return append(NtsValue.ofString(key)); }
            rehash(16);
            table = buckets;
        }
        int h = hashString(key);
        int mask = table.length - 1;
        int p = h & mask;
        long cell;
        while ((cell = table[p]) != 0L) {
            int slot = (int) cell - 1;
            NtsValue candidate = keys[slot];
            if ((int) (cell >>> 32) == h && candidate.tag == NtsValue.STRING
                    && (candidate.ref == key || candidate.ref.equals(key))) {
                return slot;
            }
            p = (p + 1) & mask;
        }
        reserveEntry();
        p = growIndex(h, p);
        int slot = append(NtsValue.ofString(key));
        buckets[p] = cell(h, slot);
        return slot;
    }

    private static int hash(NtsValue value) {
        switch (value.tag) {
            case NtsValue.NUMBER:
                return hashNumber(value.num);
            case NtsValue.BOOLEAN:
                return mix(value.num != 0.0 ? 1231 : 1237);
            case NtsValue.STRING:
                return hashString(value.ref);
            case NtsValue.UNDEFINED:
            case NtsValue.NULL:
                return mix(0);
            default:
                // `hashObject`, so a key looked up without its box cannot hash
                // differently from the same key stored with one.
                return hashObject(value.ref);
        }
    }

    // ------------------------------------------------------------------
    // java.util.Map, so a Java caller holds this object itself
    // ------------------------------------------------------------------
    //
    // **The whole point is that there is no copy.** A Java method taking a
    // `java.util.Map` receives *this table*, backed by the same `keys` and
    // `values` arrays the compiled TypeScript writes. Converting instead would
    // be O(n) plus an allocation per crossing, on every crossing.
    //
    // What it is not is literally free: each `get` and `put` converts one
    // `NtsValue` to or from a Java reference, which is a tag switch and at most
    // one box. That is O(1) against a copy's O(n), and it is the honest version
    // of the plan's "free".
    //
    // **Implemented directly rather than by extending `AbstractMap`**, which is
    // cost 6 in docs/records/notebooks/jvm-interop.md: `AbstractMap` defines `equals` and
    // `hashCode` by iterating `entrySet()` and allocating an `Entry` per
    // element, and inheriting them would put that cost on operations that do
    // not otherwise need one.
    //
    // **SameValueZero comes out exactly right, and that is the reason this
    // class is not a `LinkedHashMap` to begin with.** JS keys by SameValueZero:
    // `NaN` matches `NaN`, and `+0` matches `-0`. Java's `Double.equals` agrees
    // on the first -- `Double.equals(NaN, NaN)` is true -- and disagrees on the
    // second. Normalising `-0` to `+0` at insert, which this table already does
    // so that iteration exposes `+0`, makes the two rules coincide on every
    // input. So a Java caller's `containsKey(Double.valueOf(-0.0))` finds the
    // entry a JS caller stored as `0`, which is what both languages expect.

    /** A JS value as the nearest Java reference. `undefined` and `null` both become Java null. */
    static Object toJava(NtsValue value) {
        switch (value.tag) {
            case NtsValue.UNDEFINED:
            case NtsValue.NULL:
                return null;
            case NtsValue.BOOLEAN:
                return Boolean.valueOf(value.num != 0.0);
            case NtsValue.NUMBER:
                return Double.valueOf(value.num);
            default:
                // STRING, FUNCTION, SYMBOL and OBJECT all carry their payload in
                // `ref`, so this is a field read rather than a conversion.
                return value.ref;
        }
    }

    /** A Java reference as a JS value. The inverse of {@link #toJava}, minus the ambiguity of null. */
    static NtsValue fromJava(Object value) {
        if (value == null) { return NtsValue.NULL_VALUE; }
        if (value instanceof String) { return NtsValue.ofString((String) value); }
        if (value instanceof Double) { return NtsValue.ofNumber(((Double) value).doubleValue()); }
        if (value instanceof Number) { return NtsValue.ofNumber(((Number) value).doubleValue()); }
        if (value instanceof Boolean) { return NtsValue.ofBoolean(((Boolean) value).booleanValue()); }
        return NtsValue.ofObject(value);
    }

    /**
     * Insertion-ordered cursor over the live entries, converting lazily.
     *
     * <p>Backed by {@link #nextI}, so it walks the same storage the compiled
     * code writes and allocates nothing per element beyond whatever `toJava`
     * boxes. `remove` is unsupported: the table's cursors are absolute
     * insertion positions and a removal during iteration is the one thing that
     * would make them lie.
     */
    abstract class Cursor<T> implements java.util.Iterator<T> {
        private int at = nextI(NtsTable.this, 0);

        @Override public boolean hasNext() { return at >= 0; }

        @Override
        public T next() {
            if (at < 0) { throw new java.util.NoSuchElementException(); }
            int here = at;
            at = nextI(NtsTable.this, here + 1);
            return of(here);
        }

        @Override
        public void remove() {
            throw new UnsupportedOperationException("NtsTable cursors are absolute insertion positions");
        }

        abstract T of(int absolute);
    }
}
