package com.example;

import java.util.HashMap;
import java.util.List;

/**
 * Deliberately awkward: every row of this project's column in the coverage
 * matrix appears here, so the generated `.d.ts` beside it is a real artefact
 * rather than a sketch of a pleasant case.
 *
 * <p>Unannotated for nullability on purpose -- `describe` is marked and `name`
 * is not, so the generator has to distinguish "known null" from "not stated"
 * and the overrides file has something to do.
 */
public final class Catalog {

    /** A primitive static: has a ConstantValue attribute, so it inlines to an `ldc`. */
    public static final int MAX = 512;

    /** A String static: also ConstantValue, also inlines. */
    public static final String NAME = "catalog";

    /**
     * A reference static: NO ConstantValue attribute, so it is a real
     * `getstatic` and triggers this class's `<clinit>` on first use.
     */
    public static final Kind DEFAULT_KIND = Kind.MEDIUM;

    /** A public mutable field, the shape `android.graphics.Rect` forced. */
    public int hits;

    private final String label;

    public Catalog(String label) {
        this.label = label;
        this.hits = 0;
    }

    // --- collections, where the copy question lives -------------------------

    public HashMap<String, Integer> index() {
        HashMap<String, Integer> m = new HashMap<String, Integer>();
        m.put(label, Integer.valueOf(hits));
        return m;
    }

    public List<String> names() {
        return java.util.Arrays.asList(label, NAME);
    }

    public int[] counts() {
        return new int[] { hits, MAX };
    }

    public byte[] bytes() {
        return label.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    // --- a long, which does not fit in a double -----------------------------

    public long id() {
        return 9007199254740993L; // 2^53 + 1: not representable as a `number`
    }

    // --- the overload set ---------------------------------------------------

    public int find(int key) { return key; }
    public int find(long key) { return (int) (key % 7L); }
    public int find(double key) { return (int) Math.floor(key); }
    public int find(String key) { return key.length(); }

    /** Two equally-lossless candidates: JLS 15.12.2 picks the more specific. */
    public String render(String value) { return "s:" + value; }
    public String render(Object value) { return "o:" + value; }

    // --- varargs ------------------------------------------------------------

    public int sum(int... values) {
        int total = 0;
        for (int v : values) { total += v; }
        return total;
    }

    // --- nullability --------------------------------------------------------

    /** Annotated: the generator must surface `| null`. */
    public String describe(int id) {
        return id == 0 ? null : "item-" + id;
    }

    /** Not annotated, and never null. Only the overrides file can say so. */
    public String name() {
        return label;
    }

    // --- throwing -----------------------------------------------------------

    public int parse(String s) throws NumberFormatException {
        return Integer.parseInt(s);
    }

    // --- generics -----------------------------------------------------------

    public <T> List<T> repeat(T item, int times) {
        java.util.ArrayList<T> out = new java.util.ArrayList<T>();
        for (int i = 0; i < times; i++) { out.add(item); }
        return out;
    }

    /** A generic method whose parameter is a primitive array -- the shape that
     *  goes through the generic renderer rather than the plain one. */
    public <T> List<T> tally(T item, int[] counts) {
        java.util.ArrayList<T> out = new java.util.ArrayList<T>();
        for (int n : counts) { for (int i = 0; i < n; i++) { out.add(item); } }
        return out;
    }

    /** A wildcard in a covariant position: read-only in TypeScript terms. */
    public double total(List<? extends Number> xs) {
        double sum = 0;
        for (Number n : xs) { sum += n.doubleValue(); }
        return sum;
    }

    /** A raw type, pre-generics shaped: becomes `List<unknown>`, never `any`. */
    @SuppressWarnings("rawtypes")
    public List raw() {
        return names();
    }

    // --- nested and inner ---------------------------------------------------

    /** Static nested: binary name `com/example/Catalog$Entry`, no outer instance. */
    public static final class Entry {
        public final String key;
        public Entry(String key) { this.key = key; }
    }

    /** A true inner class: its constructor takes the outer instance first. */
    public final class Cursor {
        public int at;
        public Cursor(int at) { this.at = at; }
        public String owner() { return label; }
    }

    public Cursor cursorAt(int at) { return new Cursor(at); }
}
