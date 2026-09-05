// What a Java programmer writes for throw and catch in a loop, which is
// `throw new RuntimeException("boom")` -- and that call is most of this row.
//
// `Throwable`'s constructor calls `fillInStackTrace`, which walks the stack and
// allocates a `StackTraceElement[]`. It is the reason exceptions have a
// reputation for being slow in Java, and it is paid here 12,500 times per
// operation.
//
// **This lane does not pay it, and the reason is worth stating plainly rather
// than letting the ratio imply something vaguer.** Whether `.stack` is ever read
// is a whole-program question, and this compiler answers it -- the property is
// refused outright -- so the thrown value carries no stack trace because nothing
// could observe one. That is a compile-time fact about the entire program, and
// it is the kind of thing a JIT cannot conclude from a profile.
//
// A Java programmer who profiled this would reach for
// `super(msg, null, false, false)` and get most of it back. That is deliberately
// *not* what this reference does, because it is not what anyone writes first,
// and a reference tuned by someone who already knew the answer measures the
// tuning rather than the language. The gap this row reports is the gap a person
// actually has, and the comment is here so nobody reads the ratio as a claim
// about `athrow` being fast.
//
// `RuntimeException` rather than `Error`: `catch (e)` in TypeScript catches
// whatever was thrown, and `Error` in Java means something a program is not
// supposed to catch. The name in the TypeScript is JavaScript's `Error`, whose
// Java analogue is `RuntimeException`.
final class Ref {
    // `volatile` so the trip count is not a compile-time constant.
    private static volatile double rounds = 100000;

    static int run(int rounds) {
        int total = 0;
        for (int i = 0; i < rounds; i = i + 1) {
            try {
                if ((i & 7) == 0) {
                    throw new RuntimeException("boom");
                }
                total = total + 1;
            } catch (RuntimeException e) {
                total = total + 2;
            }
        }
        return total;
    }

    static double benchRun() {
        return run((int) rounds);
    }
}
