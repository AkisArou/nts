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
                // **Only the loader's, and everything else is printed.** A
                // handler that records every thread swallows a failure on the
                // main thread too, and the JVM then exits 1 having printed
                // nothing at all -- which is what this did, and it cost more to
                // diagnose than the bug it was hiding.
                if (who != Thread.currentThread() && "loader".equals(who.getName())) {
                    refused.append(who.getName()).append(':')
                        .append(what.getClass().getSimpleName());
                    return;
                }
                what.printStackTrace();
            }
        });

        String line = nts.gen.Program.main();

        // `Loader.load` returns as soon as it has started its thread, so the
        // callback has not necessarily run yet. Waiting is not politeness: read
        // it at the end of `main` instead and it reads 0, which is how this
        // assertion would silently stop asserting anything.
        // **The lane drains its own inbox, and that is the whole point.**
        //
        // `Loader.load` calls back on a thread it owns. The bridge does not run
        // the TypeScript there -- it posts, because everything in this runtime
        // except the inbox is confined to one lane. The work runs here, on the
        // thread that owns the lane, when this loop picks it up.
        //
        // A real application's event loop is this loop. It is written out here
        // because the project has no loop of its own, and writing it out is
        // what shows that delivery is the host's turn rather than magic.
        nts.rt.NtsEnv lane = nts.rt.NtsEnv.current();

        // **Wait for the worker to return, then check it has NOT run yet.**
        //
        // This is the assertion that distinguishes delivery from the race it
        // replaced, and without it the fixture passes either way: both end with
        // the same number written, and differ only in when. A posted callback
        // has not run when `onBytes` returns. One called directly on the
        // loader's thread has.
        //
        // Learned by sabotage: making `deliverBytes` answer "run it here" --
        // which restores exactly the unsound behaviour this work removed --
        // left the output unchanged, so the test was green for the wrong
        // reason and proved nothing.
        com.example.ui.Loader.awaitReturned();
        boolean posted = nts.gen.Program.loaded() == 0;

        long deadline = System.currentTimeMillis() + 5000;
        while (refused.length() == 0 && nts.gen.Program.loaded() == 0
            && System.currentTimeMillis() < deadline) {
            if (!nts.rt.NtsEnv.step(lane)) {
                Thread.sleep(1);
            }
        }
        if (!posted) {
            System.out.println("RAN ON THE LOADER'S THREAD, not posted");
            return;
        }
        // The refusal is appended only when there is one. It used to be
        // unconditional, which left a trailing space once delivery started
        // working -- the assertion then failed on a difference nobody could see.
        System.out.println(line + " " + (int) nts.gen.Program.loaded()
            + (refused.length() == 0 ? "" : " " + refused));
    }
}
