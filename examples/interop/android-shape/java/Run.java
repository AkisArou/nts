// Runs the TypeScript in ../src/main.ts.
//
// Separate from `Demo.java` because that one is deliberately TypeScript-free --
// it establishes the threading constraint in plain Java. This one is the other
// half: the same constraint met by our emitted classes, which is the only thing
// that can catch the day they stop meeting it.
public final class Run {
    public static void main(String[] args) throws Exception {
        // The loader's callback is refused on its own thread, so the refusal
        // arrives as an uncaught exception there rather than as a return value.
        // Recorded instead of printed: a refusal nobody asserts on is noise, and
        // this one is the project's sharpest finding.
        final StringBuilder refused = new StringBuilder();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread who, Throwable what) {
                refused.append(who.getName()).append(':').append(what.getClass().getSimpleName());
            }
        });

        String line = nts.gen.Program.main();

        // `Loader.load` returns as soon as it has started its thread, so the
        // callback has not necessarily run yet. Waiting is not politeness: read
        // it at the end of `main` instead and it reads 0, which is how this
        // assertion would silently stop asserting anything.
        long deadline = System.currentTimeMillis() + 2000;
        while (refused.length() == 0 && nts.gen.Program.loaded() == 0
            && System.currentTimeMillis() < deadline) {
            Thread.sleep(1);
        }
        System.out.println(line + " " + (int) nts.gen.Program.loaded() + " " + refused);
    }
}
