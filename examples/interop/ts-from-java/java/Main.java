// A plain Java consumer of the TypeScript in ../src/main.ts.
//
// This compiles and runs today. What it looks like is the point -- see the
// README: the published surface is correct, and it is not yet idiomatic Java.
public final class Main {
    public static void main(String[] args) {
        nts.gen.Session s = new nts.gen.Session();

        // Not `s.bump()`. Every TypeScript method is emitted as a static on
        // `Program` taking the receiver as its first argument, because
        // `Callee::Direct` lowers to `invokestatic` -- fewer instance methods
        // is faster and simpler for OUR call sites, and this is what it costs
        // a Java caller.
        double first = nts.gen.Program.Session$bump(s);
        double second = nts.gen.Program.Session$bump(s);
        double hits = nts.gen.Program.Session$hits(s);

        String greeting = nts.gen.Program.greet("java");

        // A TypeScript `number[]` is a Java `double[]`. No copy, no wrapper.
        double sum = nts.gen.Program.total(new double[] { 1, 2, 3 });

        // **A JavaScript Map, held as a java.util.Map.** No copy and no
        // wrapper: `NtsMap implements java.util.Map`, so this reference IS the
        // table the TypeScript wrote, backed by the same arrays.
        java.util.Map<Object, Object> tags = nts.gen.Program.tags();
        String kind = (String) tags.get("kind");
        int size = tags.size();

        // Insertion order survives, which a HashMap would not give.
        StringBuilder order = new StringBuilder();
        for (Object key : tags.keySet()) {
            order.append((String) key).append(' ');
        }

        // Writing through the Java interface is visible to the TypeScript side,
        // because there is only one table. A copy would pass every assertion
        // above and fail this one.
        tags.put("added", "by java");
        boolean live = nts.rt.NtsMap.has(
            (nts.rt.NtsMap) tags, nts.rt.NtsValue.ofString("added"));

        // **SameValueZero.** The TypeScript stored the key `0`; Java looks it
        // up as `-0.0` and finds it, because the table normalises `-0` to `+0`
        // at insert and that makes JS's rule coincide with `Double.equals`.
        java.util.Map<Object, Object> zeroes = nts.gen.Program.zeroKeyed();
        String byNegativeZero = (String) zeroes.get(Double.valueOf(-0.0));

        // s.$hits is NOT reachable from here: the field is package-private and
        // this class is not in `nts.gen`. Uncommenting the next line is a
        // compile error, and that error is item 0 working.
        //
        //   double peek = s.$hits;

        System.out.println(greeting + " " + first + " " + second + " " + hits + " " + sum
            + " | " + kind + " " + size + " [" + order.toString().trim() + "]"
            + " live=" + live + " svz=" + byNegativeZero);
    }
}
