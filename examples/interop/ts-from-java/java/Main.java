// A plain Java consumer of the TypeScript in ../src/main.ts.
//
// This compiles and runs today. What it looks like is the point -- see the
// README: the published surface is correct, and it is not yet idiomatic Java.
public final class Main {
    public static void main(String[] args) {
        nts.gen.Session s = new nts.gen.Session();

        // `s.bump()`, not `Program.Session$bump(s)`.
        //
        // Every TypeScript method still lowers to a static on `Program` --
        // `Callee::Direct` is an `invokestatic` and our own call sites are
        // unchanged -- but the class now carries an instance method that
        // forwards to it. Three instructions, and `benches/interop-facade`
        // measures the difference at nothing: 458.96 ns against 457.43 ns over
        // four sittings, with the spread inside each arm larger than the gap
        // between them.
        double first = s.bump();
        double second = s.bump();
        double hits = s.hits();

        String greeting = nts.gen.Program.greet("java");

        // A TypeScript `number[]` is a Java `double[]`. No copy, no wrapper.
        double sum = nts.gen.Program.total(new double[] { 1, 2, 3 });

        // **A JavaScript Map, held as a java.util.Map.** No copy and no
        // wrapper: `NtsMap implements java.util.Map`, so this reference IS the
        // table the TypeScript wrote, backed by the same arrays.
        // **`Map<String, String>`, not `Map<Object, Object>`, and no cast.**
        // The JVM erases generics, so this comes from the `Signature`
        // attribute on `tags()` -- the same mechanism that makes a Kotlin or
        // Scala jar's generics visible from Java, and the reason `NtsMap`
        // carries type parameters: a signature must erase to its descriptor,
        // so `Ljava/util/Map<...>;` over an `Lnts/rt/NtsMap;` descriptor would
        // be malformed rather than convenient.
        java.util.Map<String, String> tags = nts.gen.Program.tags();
        String kind = tags.get("kind");
        int size = tags.size();

        // Insertion order survives, which a HashMap would not give.
        StringBuilder order = new StringBuilder();
        for (String key : tags.keySet()) {
            order.append(key).append(' ');
        }

        // Writing through the Java interface is visible to the TypeScript side,
        // because there is only one table. A copy would pass every assertion
        // above and fail this one.
        tags.put("added", "by java");
        boolean live = nts.rt.NtsMap.has(
            (nts.rt.NtsMap<String, String>) tags, nts.rt.NtsValue.ofString("added"));

        // **SameValueZero.** The TypeScript stored the key `0`; Java looks it
        // up as `-0.0` and finds it, because the table normalises `-0` to `+0`
        // at insert and that makes JS's rule coincide with `Double.equals`.
        // A TypeScript `number` key is a `java.lang.Double`: a type argument
        // cannot be a primitive, and `Double` is what the table really stores.
        java.util.Map<Double, String> zeroes = nts.gen.Program.zeroKeyed();
        String byNegativeZero = zeroes.get(Double.valueOf(-0.0));

        // A TypeScript `string[]` is a Java `String[]`, on the same
        // no-copy rule as the `double[]` above.
        String joined =
            nts.gen.Program.joined(new String[] { "a", "b", "c" }, "-");

        // **A TypeScript `Set`, held as a java.util.Set.** Not a `Map`, not a
        // view, not a copy: this reference IS the table, and every `Set` API
        // works on it because it implements the interface.
        java.util.Set<String> labels = nts.gen.Program.labels();
        java.util.List<String> ordered = new java.util.ArrayList<String>(labels);
        boolean isNotAMap = !(((Object) labels) instanceof java.util.Map);

        // **A TypeScript `bigint` is `nts.rt.NtsBigInt`, not a `long`.**
        // A Java caller builds one with a factory rather than passing a
        // primitive, and reads it back as text or a `BigInteger`.
        //
        // `exceedsLong` is the argument for not publishing `long` here: that
        // signature would have truncated this result silently.
        nts.rt.NtsBigInt big =
            nts.gen.Program.scaled(nts.rt.NtsBigInt.fromLong(10000000000L));
        String scaled = nts.rt.NtsBigInt.toText(big);
        boolean exceedsLong = nts.rt.NtsBigInt.toBigInteger(big)
            .compareTo(java.math.BigInteger.valueOf(Long.MAX_VALUE)) > 0;

        // s.$hits is NOT reachable from here: the field is package-private and
        // this class is not in `nts.gen`. Uncommenting the next line is a
        // compile error, and that error is item 0 working.
        //
        //   double peek = s.$hits;

        System.out.println(greeting + " " + first + " " + second + " " + hits + " " + sum
            + " | " + kind + " " + size + " [" + order.toString().trim() + "]"
            + " live=" + live + " svz=" + byNegativeZero
            + " labels=" + labels + " n=" + ordered.size() + " notAMap=" + isNotAMap
            + " joined=" + joined + " big=" + scaled + " exceedsLong=" + exceedsLong);
    }
}
