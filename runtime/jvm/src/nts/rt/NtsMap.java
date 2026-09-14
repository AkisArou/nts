package nts.rt;

/**
 * A JavaScript `Map`, and a `java.util.Map` with no conversion between them.
 *
 * <p>The storage is {@link NtsTable}; this class is the Java-facing view of it.
 * **The split is what makes `Set` work.** One class used to serve both, carrying
 * a boolean for which it was, and it therefore implemented `java.util.Map`
 * whichever it was -- so a TypeScript `Set` reached Java as a `Map` whose values
 * equalled its keys. Coherent, and not what the TypeScript said.
 *
 * <p>The two cannot be one class: `Map.remove(Object)` returns `V` and
 * `Set.remove(Object)` returns `boolean`, and `javac` refuses a class
 * implementing both. The JVM does not -- a descriptor includes the return type,
 * so those are two methods, and `jvm-emitter/tests/runs.rs` builds such a class
 * and calls both. But this class is compiled by `javac`, so the split is the
 * answer available here, and it is the better one: the kind is now the type
 * rather than a bit, which is a compile error at every site that ignores it
 * instead of a silent wrong answer.
 */
public final class NtsMap extends NtsTable implements java.util.Map<Object, Object> {

    public static NtsMap newMap(double kind) { return new NtsMap(); }

    /**
     * Insert, and hand back the receiver.
     *
     * <p>The shared insertion is {@link NtsTable#insert}, which returns nothing:
     * all four of its returns were the receiver, so the value carried no
     * information. It is returned here rather than there so the descriptor says
     * `NtsMap` -- the backend stores this result into a slot typed by the HIR,
     * and `NtsTable` would need a checkcast at every call.
     */
    public static NtsMap set(NtsMap map, NtsValue key, NtsValue value) {
        insert(map, key, value);
        return map;
    }

    /**
     * A shallow copy, which is a `Map` because the receiver is.
     *
     * <p>Split from the single `copy` that read the kind bit and branched. The
     * backend knows each call site's HIR type, so it picks this or
     * {@link NtsSet#copy} directly and nothing reads a flag.
     */
    public static NtsMap copy(NtsMap from) {
        NtsMap out = new NtsMap();
        for (int slot = from.head; slot < from.used; slot++) {
            NtsValue key = from.keys[slot];
            if (key == null) {
                continue;
            }
            insert(out, key, from.values[slot]);
        }
        return out;
    }

    @Override public int size() { return count; }
    @Override public boolean isEmpty() { return count == 0; }
    @Override public boolean containsKey(Object key) { return has(this, fromJava(key)); }
    @Override public Object get(Object key) { return toJava(get(this, fromJava(key))); }

    @Override
    public Object put(Object key, Object value) {
        NtsValue k = fromJava(key);
        Object previous = toJava(get(this, k));
        set(this, k, fromJava(value));
        return previous;
    }

    @Override
    public Object remove(Object key) {
        NtsValue k = fromJava(key);
        Object previous = toJava(get(this, k));
        delete(this, k);
        return previous;
    }

    @Override
    public void putAll(java.util.Map<?, ?> from) {
        for (java.util.Map.Entry<?, ?> entry : from.entrySet()) {
            put(entry.getKey(), entry.getValue());
        }
    }

    @Override public void clear() { clear(this); }

    @Override
    public boolean containsValue(Object value) {
        NtsValue wanted = fromJava(value);
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            if (sameKey(valueAt(this, at), wanted)) { return true; }
        }
        return false;
    }

    @Override
    public java.util.Set<Object> keySet() {
        return new java.util.AbstractSet<Object>() {
            @Override public int size() { return count; }
            @Override public boolean contains(Object key) { return containsKey(key); }
            @Override
            public java.util.Iterator<Object> iterator() {
                return new Cursor<Object>() {
                    @Override Object of(int absolute) { return toJava(keyAtI(NtsMap.this, absolute)); }
                };
            }
        };
    }

    @Override
    public java.util.Collection<Object> values() {
        return new java.util.AbstractCollection<Object>() {
            @Override public int size() { return count; }
            @Override
            public java.util.Iterator<Object> iterator() {
                return new Cursor<Object>() {
                    @Override Object of(int absolute) { return toJava(valueAt(NtsMap.this, absolute)); }
                };
            }
        };
    }

    @Override
    public java.util.Set<java.util.Map.Entry<Object, Object>> entrySet() {
        return new java.util.AbstractSet<java.util.Map.Entry<Object, Object>>() {
            @Override public int size() { return count; }
            @Override
            public java.util.Iterator<java.util.Map.Entry<Object, Object>> iterator() {
                return new Cursor<java.util.Map.Entry<Object, Object>>() {
                    @Override
                    java.util.Map.Entry<Object, Object> of(int absolute) {
                        return new java.util.AbstractMap.SimpleImmutableEntry<Object, Object>(
                            toJava(keyAtI(NtsMap.this, absolute)), toJava(valueAt(NtsMap.this, absolute)));
                    }
                };
            }
        };
    }

    /**
     * `Map.equals`, without `AbstractMap`'s per-element `Entry` allocation.
     *
     * <p>The contract is set equality of entries, which for two maps of equal
     * size is "every key of mine is present in theirs with an equal value" --
     * checkable by walking our own storage directly.
     */
    @Override
    public boolean equals(Object other) {
        if (other == this) { return true; }
        if (!(other instanceof java.util.Map)) { return false; }
        java.util.Map<?, ?> them = (java.util.Map<?, ?>) other;
        if (them.size() != count) { return false; }
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            Object key = toJava(keyAtI(this, at));
            Object mine = toJava(valueAt(this, at));
            Object theirs = them.get(key);
            if (mine == null ? theirs != null || !them.containsKey(key) : !mine.equals(theirs)) {
                return false;
            }
        }
        return true;
    }

    /** `Map.hashCode`: the sum of the entries' hashes, order-independent by contract. */
    @Override
    public int hashCode() {
        int total = 0;
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            Object key = toJava(keyAtI(this, at));
            Object value = toJava(valueAt(this, at));
            total += (key == null ? 0 : key.hashCode()) ^ (value == null ? 0 : value.hashCode());
        }
        return total;
    }

    /** Absolute-index value read, the companion `valueAt` has for doubles. */
    private static NtsValue valueAt(NtsMap map, int absolute) {
        return valueAt(map, (double) absolute);
    }

    /**
     * `{kind=session, state=open}`, which is what `AbstractMap` prints.
     *
     * <p>Neither this class nor `NtsSet` had one, so a Java caller printing a
     * table got `nts.rt.NtsMap@7662b902` -- an identity hash where every other
     * `java.util.Map` prints its contents. Found while checking that a `Set`
     * crossing looked right; the `Map` had been wrong since it first crossed.
     *
     * <p>Self-reference prints `(this Map)` rather than recursing, which is the
     * contract `AbstractMap` keeps and the only part of this that is not
     * obvious.
     */
    @Override
    public String toString() {
        StringBuilder out = new StringBuilder("{");
        boolean first = true;
        for (int at = nextI(this, 0); at >= 0; at = nextI(this, at + 1)) {
            if (!first) { out.append(", "); }
            first = false;
            Object key = toJava(keyAtI(this, at));
            Object value = toJava(valueAt(this, (double) at));
            out.append(key == this ? "(this Map)" : key);
            out.append('=');
            out.append(value == this ? "(this Map)" : value);
        }
        return out.append('}').toString();
    }
}
