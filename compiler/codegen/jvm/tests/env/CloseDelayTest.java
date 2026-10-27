import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import nts.rt.NtsEnv;
import nts.rt.NtsInbox;
import nts.rt.NtsRefusal;
import nts.rt.NtsResumable;

/** A delayed completion is live work, not a leaked credit. */
public final class CloseDelayTest {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) { failures++; System.out.println("FAILED: " + what); }
    }

    static void run(final boolean joinFirst) throws Exception {
        final CountDownLatch ready = new CountDownLatch(1);
        final CountDownLatch close = new CountDownLatch(1);
        final CountDownLatch settle = new CountDownLatch(1);
        final CountDownLatch returned = new CountDownLatch(1);
        final AtomicReference<NtsEnv> environment = new AtomicReference<NtsEnv>();
        final AtomicReference<NtsInbox.Slot> held = new AtomicReference<NtsInbox.Slot>();
        final AtomicReference<String> failure = new AtomicReference<String>();
        final AtomicInteger creditsAtReturn = new AtomicInteger();
        final AtomicInteger outstandingAtReturn = new AtomicInteger();
        final AtomicInteger callbacks = new AtomicInteger();
        Thread owner = new Thread(new Runnable() {
            @Override public void run() {
                NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 26);
                NtsEnv previous = NtsEnv.enterEnv(env);
                environment.set(env);
                for (int i = 0; i < 25; i++) { NtsInbox.post(NtsEnv.launch(env), null); }
                held.set(NtsEnv.launch(env));
                ready.countDown();
                try {
                    close.await();
                    NtsEnv.close(env);
                } catch (NtsRefusal refused) {
                    failure.set(refused.getMessage());
                } catch (InterruptedException interrupted) {
                    failure.set("owner interrupted");
                } finally {
                    creditsAtReturn.set(NtsInbox.available(NtsEnv.inbox(env)));
                    outstandingAtReturn.set((int) NtsEnv.outstanding(env));
                    NtsEnv.leaveEnv(env, previous);
                    returned.countDown();
                }
            }
        }, "close-delay-owner");
        owner.setDaemon(true);
        owner.start();
        if (!ready.await(10, TimeUnit.SECONDS)) { throw new AssertionError("owner never started"); }
        Thread producer = new Thread(new Runnable() {
            @Override public void run() {
                try { settle.await(); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                NtsInbox.post(held.get(), new NtsResumable() {
                    @Override public void resume() { callbacks.incrementAndGet(); }
                });
            }
        }, "close-delay-producer");
        producer.setDaemon(true);
        producer.start();
        if (joinFirst) {
            // The control changes only the ordering: settle before close.
            settle.countDown();
            producer.join();
            close.countDown();
        } else {
            close.countDown();
            long watchdog = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (!NtsInbox.isClosed(NtsEnv.inbox(environment.get()))) {
                if (System.nanoTime() > watchdog) { throw new AssertionError("close never started"); }
                Thread.yield();
            }
            // Start the delay only after reclaim has closed the inbox. It
            // cannot be consumed by JVM startup or the owner's scheduling.
            Thread.sleep(2200);
            check(returned.getCount() == 1, "close returned before the held completion settled");
            settle.countDown();
        }
        producer.join(10_000);
        owner.join(10_000);
        String label = joinFirst ? "join-first control" : "forced delayed settlement";
        System.out.println(label + ": close returned " + creditsAtReturn.get() + " of 26 credits; "
            + outstandingAtReturn.get() + " outstanding; " + failure.get());
        check(!owner.isAlive() && !producer.isAlive(), label + " did not finish after settlement");
        check(failure.get() == null, label + " reported " + failure.get());
        check(creditsAtReturn.get() == 26, "close returned " + creditsAtReturn.get() + " of 26 credits");
        check(outstandingAtReturn.get() == 0, label + " left " + outstandingAtReturn.get() + " outstanding");
        check(callbacks.get() == 0, label + " ran a completion during close");
    }

    public static void main(String[] args) throws Exception {
        run(args.length != 0 && args[0].equals("join-first"));
        System.out.println("close delay: " + checks + " checks, " + failures + " failures");
        if (failures != 0) { System.exit(1); }
    }
}
