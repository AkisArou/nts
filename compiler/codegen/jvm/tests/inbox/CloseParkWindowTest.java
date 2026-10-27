package nts.rt;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Return the last credit after reclaim checks it, before reclaim parks. */
public final class CloseParkWindowTest {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) { failures++; System.out.println("FAILED: " + what); }
    }

    /** A foreign close cannot become a second consumer of the queue head. */
    static void foreignCloseIsRefused() throws Exception {
        final CountDownLatch delivering = new CountDownLatch(1);
        final CountDownLatch resume = new CountDownLatch(1);
        final CountDownLatch refused = new CountDownLatch(1);
        final AtomicReference<NtsEnv> environment = new AtomicReference<NtsEnv>();
        final AtomicReference<Throwable> ownerFailure = new AtomicReference<Throwable>();
        final AtomicReference<String> report = new AtomicReference<String>();
        final AtomicReference<String> enterReport = new AtomicReference<String>();
        final AtomicReference<String> leaveReport = new AtomicReference<String>();
        final AtomicInteger leaveRefusals = new AtomicInteger();
        final AtomicBoolean contextUnchanged = new AtomicBoolean();
        final AtomicBoolean nestedRestored = new AtomicBoolean();
        Thread lane = new Thread(new Runnable() {
            @Override public void run() {
                NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 26);
                NtsEnv previous = NtsEnv.enterEnv(env);
                environment.set(env);
                try {
                    NtsInbox.post(NtsEnv.launch(env), new NtsResumable() {
                        @Override public void resume() {
                            NtsEnv nested = NtsEnv.enterEnv(env);
                            NtsEnv.leaveEnv(env, nested);
                            nestedRestored.set(NtsEnv.installed() == env);
                            delivering.countDown();
                            try { resume.await(); }
                            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                        }
                    });
                    for (int i = 0; i < 25; i++) { NtsInbox.post(NtsEnv.launch(env), null); }
                    NtsEnv.deliver(env);
                    NtsEnv.close(env);
                } catch (Throwable failed) {
                    ownerFailure.set(failed);
                } finally {
                    NtsEnv.leaveEnv(env, previous);
                }
            }
        }, "single-consumer-owner");
        lane.setDaemon(true);
        lane.start();
        if (!delivering.await(10, java.util.concurrent.TimeUnit.SECONDS)) {
            throw new AssertionError("the owner never entered delivery");
        }
        Thread foreign = new Thread(new Runnable() {
            @Override public void run() {
                NtsEnv before = NtsEnv.installed();
                try {
                    try { NtsEnv.enterEnv(environment.get()); }
                    catch (IllegalStateException invariant) { enterReport.set(invariant.getMessage()); }
                    try { NtsEnv.leaveEnv(environment.get(), null); }
                    catch (IllegalStateException invariant) {
                        leaveReport.set(invariant.getMessage()); leaveRefusals.incrementAndGet();
                    }
                    try { NtsEnv.leaveEnv(environment.get(), environment.get()); }
                    catch (IllegalStateException invariant) { leaveRefusals.incrementAndGet(); }
                    try { NtsEnv.close(environment.get()); }
                    catch (IllegalStateException invariant) { report.set(invariant.getMessage()); }
                    contextUnchanged.set(NtsEnv.installed() == before);
                } finally { refused.countDown(); }
            }
        }, "foreign-closer");
        foreign.setDaemon(true);
        foreign.start();
        try {
            boolean finished = refused.await(10, java.util.concurrent.TimeUnit.SECONDS);
            check(finished && report.get() != null && report.get().contains("single-consumer-owner")
                && report.get().contains("foreign-closer"), "foreign close did not name both threads: " + report.get());
            check(enterReport.get() != null && enterReport.get().contains("single-consumer-owner")
                && enterReport.get().contains("foreign-closer"), "foreign enter stole ownership: " + enterReport.get());
            check(leaveRefusals.get() == 2 && leaveReport.get() != null
                && leaveReport.get().contains("single-consumer-owner") && leaveReport.get().contains("foreign-closer"),
                "foreign leave released ownership: " + leaveReport.get());
            check(contextUnchanged.get(), "a refused foreign operation changed CURRENT");
            check(nestedRestored.get(), "nested enter/leave did not restore the environment");
            check(!NtsEnv.isClosed(environment.get()) && !NtsInbox.isClosed(NtsEnv.inbox(environment.get())),
                "foreign close changed closed before refusing");
        } finally {
            resume.countDown();
        }
        lane.join(10_000);
        check(!lane.isAlive() && ownerFailure.get() == null, "the owner failed to close: " + ownerFailure.get());
        check(NtsInbox.available(NtsEnv.inbox(environment.get())) == 26 && NtsEnv.outstanding(environment.get()) == 0,
            "the owner did not return all 26 credits");
    }

    static void window(final boolean abandon) throws Exception {
        final NtsInbox inbox = NtsInbox.withCapacity(26);
        for (int i = 0; i < 25; i++) { NtsInbox.post(NtsInbox.reserve(inbox), null); }
        final NtsInbox.Slot last = NtsInbox.reserve(inbox);
        final CountDownLatch checked = new CountDownLatch(1);
        final AtomicBoolean settled = new AtomicBoolean();
        final AtomicBoolean finished = new AtomicBoolean();
        final AtomicInteger checkpoints = new AtomicInteger();
        Thread producer = new Thread(new Runnable() {
            @Override public void run() {
                try { checked.await(); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                if (abandon) { NtsInbox.abandon(last); }
                else { NtsInbox.post(last, null); }
                settled.set(true);
            }
        });
        producer.setDaemon(true);
        producer.start();
        Thread closer = new Thread(new Runnable() {
            @Override public void run() {
                NtsInbox.reclaim(inbox, new Runnable() {
                    @Override public void run() {
                        checkpoints.incrementAndGet();
                        checked.countDown();
                        // Do not await/join here: those may park and consume
                        // the very permit whose retention this test proves.
                        long watchdog = System.nanoTime() + 10_000_000_000L;
                        while (!settled.get()) {
                            if (System.nanoTime() > watchdog) { throw new AssertionError("producer never settled"); }
                            Thread.yield();
                        }
                    }
                });
                finished.set(true);
            }
        });
        closer.setDaemon(true);
        closer.start();
        closer.join(10_000);
        producer.join(10_000);
        check(finished.get() && !closer.isAlive(), "last-credit notification was lost before park (abandon=" + abandon + ")");
        check(checkpoints.get() == 1, "the check-before-park window was not forced exactly once");
        check(NtsInbox.available(inbox) == 26, "close returned " + NtsInbox.available(inbox) + " of 26 credits");
    }

    public static void main(String[] args) throws Exception {
        window(false);
        window(true);
        foreignCloseIsRefused();
        System.out.println("close park window: " + checks + " checks, " + failures + " failures");
        if (failures != 0) { System.exit(1); }
    }
}
