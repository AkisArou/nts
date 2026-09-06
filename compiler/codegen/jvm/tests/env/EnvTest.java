import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import nts.rt.NtsCallback;
import nts.rt.NtsEnv;
import nts.rt.NtsInbox;
import nts.rt.NtsRefusal;
import nts.rt.NtsResumable;

/** What an environment is for: isolation, two clocks, liveness, and letting go. */
public final class EnvTest {
    static int failures;
    static void check(boolean ok, String what) {
        if (!ok) { failures++; if (failures < 8) { System.out.println("FAILED: " + what); } }
    }

    /** Two environments do not see each other's timers, queues or clocks. */
    static void isolation() {
        NtsEnv a = NtsEnv.create(NtsEnv.VIRTUAL);
        NtsEnv b = NtsEnv.create(NtsEnv.VIRTUAL);
        final StringBuilder log = new StringBuilder();
        NtsEnv.postDelayed(a, new NtsCallback() { public void call() { log.append('a'); } }, 10, false);
        NtsEnv.postDelayed(b, new NtsCallback() { public void call() { log.append('b'); } }, 5, false);
        NtsEnv.drain(a);
        check(log.toString().equals("a"), "draining one environment ran the other's timer: " + log);
        NtsEnv.drain(b);
        check(log.toString().equals("ab"), "the second environment did not run its own timer: " + log);
        // Virtual clocks advance independently, to their own timers.
        check(NtsEnv.now(a) == 10.0, "environment a's clock is " + NtsEnv.now(a));
        check(NtsEnv.now(b) == 5.0, "environment b's clock is " + NtsEnv.now(b));
    }

    /** Virtual time jumps and is reproducible; monotonic time does not jump. */
    static void clocks() {
        NtsEnv virtual = NtsEnv.create(NtsEnv.VIRTUAL);
        NtsEnv.postDelayed(virtual, new NtsCallback() { public void call() { } }, 3_600_000, false);
        long before = System.nanoTime();
        NtsEnv.drain(virtual);
        long spent = System.nanoTime() - before;
        check(NtsEnv.now(virtual) == 3_600_000.0, "virtual time did not jump to the due moment");
        check(spent < 1_000_000_000L, "a virtual hour took " + (spent / 1_000_000) + "ms of real time");

        NtsEnv real = NtsEnv.create(NtsEnv.MONOTONIC);
        check(NtsEnv.isMonotonic(real), "a monotonic environment reports virtual");
        double first = NtsEnv.now(real);
        check(first >= 0.0 && first < 1000.0, "a fresh monotonic clock reads " + first);
        final boolean[] fired = { false };
        NtsEnv.postDelayed(real, new NtsCallback() { public void call() { fired[0] = true; } }, 20, false);
        long start = System.nanoTime();
        NtsEnv.drain(real);
        long waited = (System.nanoTime() - start) / 1_000_000;
        check(fired[0], "a monotonic timer never fired");
        check(waited >= 18, "a 20ms monotonic timer returned after " + waited + "ms -- it jumped");
    }

    /** Liveness is taken before the work and returned exactly once, every way. */
    static void liveness() {
        NtsEnv env = NtsEnv.create(NtsEnv.VIRTUAL, 4);
        check(NtsEnv.outstanding(env) == 0.0, "a fresh environment is not idle");
        NtsInbox.Slot delivered = NtsEnv.launch(env);
        NtsInbox.Slot cancelled = NtsEnv.launch(env);
        NtsInbox.Slot dropped = NtsEnv.launch(env);
        check(NtsEnv.outstanding(env) == 3.0, "three launches count " + NtsEnv.outstanding(env));
        check(NtsEnv.launch(env) != null, "the fourth credit was refused");
        check(NtsEnv.launch(env) == null, "the ceiling did not hold");

        final boolean[] ran = { false };
        NtsInbox.post(delivered, new NtsResumable() { public void resume() { ran[0] = true; } });
        check(NtsEnv.deliver(env) == 1.0, "delivery did not run exactly one completion");
        check(ran[0], "the completion did not run");
        NtsEnv.cancel(env, cancelled);
        check(NtsEnv.outstanding(env) == 2.0, "after one delivery and one cancel, "
            + NtsEnv.outstanding(env) + " outstanding");

        NtsInbox.post(dropped, null);
        // A launch that never settles is a leak, and close says so rather than
        // reporting a tidy zero. This one is deliberate: `neverSettles` was
        // reserved and abandoned by nobody.
        NtsInbox.Slot neverSettles = NtsEnv.launch(env);
        check(neverSettles != null, "the environment refused a credit it had");
        try {
            NtsEnv.close(env);
            check(false, "close absorbed a credit held by work that never settled");
        } catch (NtsRefusal reported) {
            check(reported.getMessage().contains("never settled"),
                "close refused for the wrong reason: " + reported.getMessage());
        }
        check(NtsEnv.isClosed(env), "close did not close");
        try {
            NtsEnv.launch(env);
            check(false, "a closed environment accepted new work");
        } catch (NtsRefusal expected) {
            // The point.
        }
    }

    /** The ordinary case: everything settles, and close is silent. */
    static void cleanClose() {
        NtsEnv env = NtsEnv.create(NtsEnv.VIRTUAL, 4);
        NtsInbox.Slot a = NtsEnv.launch(env);
        NtsInbox.Slot b = NtsEnv.launch(env);
        NtsInbox.post(a, null);
        NtsEnv.cancel(env, b);
        NtsEnv.close(env);
        check(NtsEnv.outstanding(env) == 0.0, "a clean close left " + NtsEnv.outstanding(env));
        check(NtsInbox.available(NtsEnv.inbox(env)) == 4, "a clean close returned "
            + NtsInbox.available(NtsEnv.inbox(env)) + " of 4 credits");
    }

    /** A monotonic lane waits for outstanding work rather than exiting idle. */
    static void waitsForExternalWork() throws Exception {
        final NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            final NtsInbox.Slot slot = NtsEnv.launch(env);
            final boolean[] arrived = { false };
            Thread worker = new Thread(new Runnable() {
                public void run() {
                    try { Thread.sleep(60); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    NtsInbox.post(slot, new NtsResumable() { public void resume() { arrived[0] = true; } });
                }
            });
            long start = System.nanoTime();
            worker.start();
            NtsEnv.drain(env);
            long waited = (System.nanoTime() - start) / 1_000_000;
            check(arrived[0], "drain returned before the external completion arrived");
            check(waited >= 50, "drain returned after " + waited + "ms without waiting for the work");
            check(NtsEnv.outstanding(env) == 0.0, "the delivered work left " + NtsEnv.outstanding(env));
            worker.join();
        } finally {
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /**
     * The reachability check the plan requires, and the reason a counter cannot
     * stand in for it.
     *
     * <p>On a collector-backed provider nothing counts a retained callback: the
     * collector simply keeps it alive and no number anywhere changes. So
     * retirement is proved by a weak reference that must clear, not by
     * arithmetic that must reach zero.
     *
     * <p>The environment is entered and left, which is where the leak would
     * be: a `ThreadLocal` still holding a closed environment retains its queues
     * and every callback in them for the life of the thread.
     */
    static void closedEnvironmentLetsGo() {
        WeakReference<?>[] refs = buildCloseAndDrop();
        check(cleared(refs[0]), "a closed environment still retains its callbacks");
        check(cleared(refs[1]), "the thread still retains the closed environment itself");
    }

    /**
     * A separate method, and that is not style.
     *
     * <p>A local holding the subject keeps it reachable from the frame for the
     * whole method, whatever the scope braces say -- javac keeps it in the
     * local variable table and the collector believes the table. Written inline
     * this test failed against a runtime that was releasing correctly, which is
     * the worst kind of false negative: it accuses the code under test.
     * Returning only the weak references pops the frame that held them.
     */
    static WeakReference<?>[] buildCloseAndDrop() {
        NtsEnv env = NtsEnv.create(NtsEnv.VIRTUAL);
        NtsEnv previous = NtsEnv.enterEnv(env);
        Object token = new Object();
        final Object[] held = { token };
        NtsEnv.postDelayed(env, new NtsCallback() { public void call() { held[0].hashCode(); } }, 1000, true);
        NtsEnv.microtask(env, new NtsResumable() { public void resume() { held[0].hashCode(); } });
        WeakReference<Object> callbackRef = new WeakReference<Object>(token);
        WeakReference<NtsEnv> envRef = new WeakReference<NtsEnv>(env);
        NtsEnv.close(env);
        NtsEnv.leaveEnv(env, previous);
        return new WeakReference<?>[] { callbackRef, envRef };
    }

    /** Bounded rather than open-ended: a collection that never comes is a hang. */
    static boolean cleared(WeakReference<?> ref) {
        for (int attempt = 0; attempt < 40; attempt++) {
            if (ref.get() == null) { return true; }
            System.gc();
            try { Thread.sleep(25); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        return ref.get() == null;
    }

    public static void main(String[] args) throws Exception {
        isolation();
        clocks();
        liveness();
        cleanClose();
        waitsForExternalWork();
        closedEnvironmentLetsGo();
        System.out.printf("environment: isolation, clocks, liveness, waiting and retirement -- %d failures%n",
            failures);
        if (failures != 0) { System.exit(1); }
    }
}
