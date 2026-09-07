import java.lang.ref.ReferenceQueue;
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
    /**
     * How many checks ran, printed beside the failures.
     *
     * Zero failures is satisfied by a suite that stopped running. A count is
     * what makes that visible, and it is the same assertion `android.rs` makes
     * about `PASS: 11` -- which I wrote and then did not apply here.
     */
    static int checks;

    static void check(boolean ok, String what) {
        checks++;
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
        // **The instrument first.** On API 26 under `app_process` a weak
        // reference to a plainly dead object is neither cleared nor enqueued --
        // measured directly, with a reference that has no relationship to this
        // runtime at all. The queue then stays empty for a reason that has
        // nothing to do with any subject, and this test read that as "after
        // close, the runtime still retains its callbacks": a false accusation
        // against code that had released correctly.
        //
        // **The control, because this check once accused the code under test.**
        // On API 26 it reported "after close, the runtime still retains its
        // callbacks" about a runtime that had released correctly.
        //
        // The cause took three wrong answers to find and is one line: `gc` does
        // not wait for reference processing. ART hands that to a daemon, and
        // the loop below asked sixty times and never waited. `runFinalization`
        // waits, and with it the first attempt succeeds -- on the same device,
        // the same heap, the same references.
        //
        // The control stays anyway. It was right through all three wrong
        // explanations precisely because it never depended on one: it asks
        // whether a reference to an object with no relationship to this runtime
        // gets cleared, and skips if not. A control detects a condition; a
        // diagnosis names a cause; turning the first into the second is what
        // produced the false accusation.
        //
        // It cost an hour and two wrong diagnoses before the control was
        // written, and the control is four lines. A test whose instrument can
        // be dead has to say which it is measuring.
        if (!collectorClearsReferences()) {
            System.out.println("SKIP retirement: this runtime never cleared a reference to a "
                + "plainly dead object, so the queue says nothing about any subject");
            return;
        }
        // Held for the whole check. A `WeakReference` that is itself collected
        // is never enqueued, and the queue then stays empty for a reason that
        // has nothing to do with the referents -- which reads exactly like a
        // leak.
        held = buildCloseAndDrop();
        String missing = notEnqueued(2);
        check(missing == null, "after close, the runtime still retains " + missing);
    }

    /**
     * Does a weak reference to an object nothing can reach get cleared here?
     *
     * <p>The control for the check below. It is deliberately about an object
     * with no relationship to the runtime at all -- if this does not clear,
     * nothing the queue reports means anything, and a failure below would be
     * about the collector rather than about what was closed.
     */
    static boolean collectorClearsReferences() {
        ReferenceQueue<Object> control = new ReferenceQueue<Object>();
        WeakReference<Object> dead = deadReference(control);
        for (int attempt = 0; attempt < 60; attempt++) {
            System.gc();
            // **`gc` alone is not enough on ART**, and this is the whole of why
            // the check below used to skip on API 26. A collection happens;
            // reference *processing* is handed to a daemon, and `gc` does not
            // wait for it. `runFinalization` does, and with it the very first
            // attempt enqueues on API 26 -- where sixty attempts of `gc` and
            // four hundred times the allocation churn never did.
            System.runFinalization();
            for (int i = 0; i < 200; i++) {
                byte[] waste = new byte[8192];
                waste[0] = 1;
            }
            try { Thread.sleep(25); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            if (control.poll() != null) {
                return true;
            }
        }
        // Named so the reference itself is not what was collected.
        return dead.get() == null;
    }

    /** In its own frame, for the reason `buildCloseAndDrop` documents. */
    static WeakReference<Object> deadReference(ReferenceQueue<Object> queue) {
        return new WeakReference<Object>(new Object(), queue);
    }

    static Named[] held;

    /** A weak reference that says what it was pointing at. */
    static final class Named extends WeakReference<Object> {
        final String what;
        Named(Object referent, String what) {
            super(referent, QUEUE);
            this.what = what;
        }
    }

    static final ReferenceQueue<Object> QUEUE = new ReferenceQueue<Object>();

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
    static Named[] buildCloseAndDrop() {
        NtsEnv env = NtsEnv.create(NtsEnv.VIRTUAL);
        NtsEnv previous = NtsEnv.enterEnv(env);
        Object token = new Object();
        final Object[] captured = { token };
        NtsEnv.postDelayed(env, new NtsCallback() { public void call() { captured[0].hashCode(); } }, 1000, true);
        NtsEnv.microtask(env, new NtsResumable() { public void resume() { captured[0].hashCode(); } });
        Named callbackRef = new Named(token, "its callbacks");
        Named envRef = new Named(env, "the closed environment itself");
        NtsEnv.close(env);
        NtsEnv.leaveEnv(env, previous);
        return new Named[] { callbackRef, envRef };
    }

    /**
     * Waits for `want` references to be enqueued, and names one that never is.
     *
     * <h2>The queue, and never `get()`</h2>
     *
     * This used to poll `ref.get() == null`, which works on HotSpot and **can
     * never succeed on ART**. ART's collector is concurrent copying with read
     * barriers, and a read barrier on a weak reference *re-marks the referent*
     * -- so asking whether the object is gone is what stops it going. The loop
     * ran forty times, kept the object alive forty times, and reported a leak
     * in a runtime that was releasing correctly.
     *
     * <p>It was found by running this suite on a device, and it is the third
     * time this one test has accused correct code: first a local kept the
     * subject reachable from the frame, then it needed its own method so the
     * frame would pop, and now the poll itself was the retention. A reachability
     * test is unusually good at passing for the wrong reason and unusually bad
     * at failing for the right one.
     *
     * <p>A `ReferenceQueue` observes the clearing without touching the referent,
     * which is the technique that works on both. Bounded rather than
     * open-ended: a collection that never comes is a hang.
     */
    static String notEnqueued(int want) {
        List<Named> seen = new ArrayList<Named>();
        for (int attempt = 0; attempt < 60 && seen.size() < want; attempt++) {
            System.gc();
            // `gc` is a hint and does not wait for reference processing, which
            // ART hands to a daemon; `runFinalization` waits. See the control.
            System.runFinalization();
            // Allocation as well as a request. `System.gc()` is a hint on ART,
            // and a hint is not a guarantee that reference processing ran.
            for (int i = 0; i < 200; i++) {
                byte[] waste = new byte[8192];
                waste[0] = 1;
            }
            try { Thread.sleep(25); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            for (Object polled = QUEUE.poll(); polled != null; polled = QUEUE.poll()) {
                seen.add((Named) polled);
            }
        }
        if (seen.size() >= want) { return null; }
        for (Named ref : held) {
            if (!seen.contains(ref)) { return ref.what; }
        }
        return "something it did not name";
    }

    public static void main(String[] args) throws Exception {
        isolation();
        clocks();
        liveness();
        cleanClose();
        waitsForExternalWork();
        closedEnvironmentLetsGo();
        System.out.printf("environment: isolation, clocks, liveness, waiting and retirement -- %d checks, %d failures%n",
            checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
