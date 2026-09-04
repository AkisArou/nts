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

    private NtsMap() {}

    public static NtsMap newMap(double kind) { return new NtsMap(); }
    public static NtsMap newSet(double kind) { return new NtsMap(); }
    public static double size(NtsMap map) { return map.count; }

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
                h = System.identityHashCode(value.ref);
                break;
        }
        h ^= value.tag * 0x9e3779b9;
        h ^= h >>> 16;
        h *= 0x7feb352d;
        h ^= h >>> 15;
        h *= 0x846ca68b;
        return h ^ (h >>> 16);
    }
}
