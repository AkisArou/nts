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

        // s.$hits is NOT reachable from here: the field is package-private and
        // this class is not in `nts.gen`. Uncommenting the next line is a
        // compile error, and that error is item 0 working.
        //
        //   double peek = s.$hits;

        System.out.println(greeting + " " + first + " " + second + " " + hits + " " + sum);
    }
}
