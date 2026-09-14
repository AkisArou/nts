package nts.rt;

/**
 * A JavaScript `Set`, and a `java.util.Set` with no conversion between them.
 *
 * <p>The same storage as {@link NtsMap} -- a set is a table that holds no
 * values -- and a different Java face. Before the split there was one class
 * implementing `java.util.Map`, so a TypeScript `Set` published to Java as a
 * `Map` whose values equalled its keys. A Java caller wanting a `Set` had to
 * call `keySet()`, which is an O(1) view and still an allocation and still the
 * wrong type in every signature.
 *
 * <p>**Not `AbstractSet`**, which would have supplied most of this: a class has
 * one superclass and this one's is {@link NtsTable}, where the storage lives.
 * The contract below is written out rather than inherited, which is the price
 * of the storage being shared by inheritance rather than by a field.
 */
public final class NtsSet extends NtsTable implements java.util.Set<Object> {

    public static NtsSet newSet(double kind) { return new NtsSet(); }

    /** Insert, and hand back the receiver; see {@link NtsMap#set}. */
    public static NtsSet add(NtsSet set, NtsValue key) {
        // Set iteration must expose +0, not the -0 supplied by the caller.
        NtsValue canonical = canonicalKey(key);
        insert(set, canonical, canonical);
        return set;
    }

    /** A shallow copy, which is a `Set` because the receiver is. */
    public static NtsSet copy(NtsSet from) {
        NtsSet out = new NtsSet();
        for (int slot = from.head; slot < from.used; slot++) {
            NtsValue key = from.keys[slot];
            if (key == null) {
                continue;
            }
            add(out, key);
        }
        return out;
    }

    @Override public int size() { return count; }
    @Override public boolean isEmpty() { return count == 0; }
    @Override public boolean contains(Object value) { return has(this, fromJava(value)); }
    @Override public void clear() { clear(this); }

    @Override
    public boolean add(Object value) {
        NtsValue v = fromJava(value);
        if (has(this, v)) {
            return false;
        }
        add(this, v);
        return true;
    }

    /**
     * `boolean`, where {@link NtsMap#remove} returns the previous value.
     *
     * <p>This one method is the whole reason the two are separate classes.
     */
    @Override
    public boolean remove(Object value) {
        return delete(this, fromJava(value));
    }

    @Override
    public java.util.Iterator<Object> iterator() {
        return new Cursor<Object>() {
            @Override Object of(int absolute) { return toJava(keyAtI(NtsSet.this, absolute)); }
        };
    }

    @Override
    public Object[] toArray() {
        Object[] out = new Object[count];
        int written = 0;
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            out[written++] = toJava(keyAtI(this, at));
        }
        return out;
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> T[] toArray(T[] into) {
        T[] out = into.length >= count
            ? into
            : (T[]) java.lang.reflect.Array.newInstance(into.getClass().getComponentType(), count);
        int written = 0;
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            out[written++] = (T) toJava(keyAtI(this, at));
        }
        if (out.length > count) {
            out[count] = null;
        }
        return out;
    }

    @Override
    public boolean containsAll(java.util.Collection<?> them) {
        for (Object value : them) {
            if (!contains(value)) {
                return false;
            }
        }
        return true;
    }

    @Override
    public boolean addAll(java.util.Collection<?> them) {
        boolean changed = false;
        for (Object value : them) {
            changed |= add(value);
        }
        return changed;
    }

    @Override
    public boolean removeAll(java.util.Collection<?> them) {
        boolean changed = false;
        for (Object value : them) {
            changed |= remove(value);
        }
        return changed;
    }

    /**
     * Collects first, then removes.
     *
     * <p>A cursor is an absolute insertion position and removing during a walk
     * is the one thing that would make it lie -- which is why {@link
     * NtsTable.Cursor#remove} throws. So this pays one array rather than
     * corrupting the walk.
     */
    @Override
    public boolean retainAll(java.util.Collection<?> them) {
        Object[] doomed = new Object[count];
        int found = 0;
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            Object value = toJava(keyAtI(this, at));
            if (!them.contains(value)) {
                doomed[found++] = value;
            }
        }
        for (int at = 0; at < found; at++) {
            remove(doomed[at]);
        }
        return found > 0;
    }

    /** `Set.equals`: same size, and every element of mine in theirs. */
    @Override
    public boolean equals(Object other) {
        if (other == this) { return true; }
        if (!(other instanceof java.util.Set)) { return false; }
        java.util.Set<?> them = (java.util.Set<?>) other;
        if (them.size() != count) { return false; }
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            if (!them.contains(toJava(keyAtI(this, at)))) {
                return false;
            }
        }
        return true;
    }

    /** `Set.hashCode`: the sum of the elements' hashes, order-independent by contract. */
    @Override
    public int hashCode() {
        int total = 0;
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            Object value = toJava(keyAtI(this, at));
            total += value == null ? 0 : value.hashCode();
        }
        return total;
    }

    /** `[alpha, beta]`, which is what `AbstractCollection` prints; see {@link NtsMap#toString}. */
    @Override
    public String toString() {
        StringBuilder out = new StringBuilder("[");
        boolean first = true;
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            if (!first) { out.append(", "); }
            first = false;
            Object value = toJava(keyAtI(this, at));
            out.append(value == this ? "(this Collection)" : value);
        }
        return out.append(']').toString();
    }
}
