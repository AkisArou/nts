import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import nts.rt.NtsEnv;
import nts.rt.NtsInbox;
import nts.rt.NtsRefusal;
import nts.rt.NtsResumable;

/**
 * Closing while completions are still arriving.
 *
 * <p>The interesting instant is the one with no lock in it: a worker has read
 * the closed flag as false and is about to link its slot, and the owner lane is
 * inside close. Whatever happens, three things must hold — **no completion runs
 * after close, every credit comes back, and liveness reaches zero** — and they
 * must hold for every interleaving rather than the one this machine happens to
 * produce, which is why the race is run many times with the closing moment
 * moved around inside it.
 */
public final class CloseRaceTest {
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

    /** One race. `stagger` moves where close lands relative to the posts. */
    static void race(int producers, int stagger) throws Exception {
        final NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, producers * 2);
        NtsEnv previous = NtsEnv.enterEnv(env);
        final AtomicInteger ranAfterClose = new AtomicInteger();
        final AtomicInteger threw = new AtomicInteger();
        final boolean[] closed = { false };
        try {
            final CountDownLatch go = new CountDownLatch(1);
            Thread[] workers = new Thread[producers];
            for (int i = 0; i < producers; i++) {
                final NtsInbox.Slot slot = NtsEnv.launch(env);
                final int spin = i * stagger;
                workers[i] = new Thread(new Runnable() {
                    @Override public void run() {
                        try { go.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                        for (int s = 0; s < spin; s++) { Thread.yield(); }
                        try {
                            NtsInbox.post(slot, new NtsResumable() {
                                @Override public void resume() {
                                    if (closed[0]) { ranAfterClose.incrementAndGet(); }
                                }
                            });
                        } catch (NtsRefusal refused) {
                            // Posting to a returned slot is a defect, not a
                            // tolerated outcome; count it and let the check fail.
                            threw.incrementAndGet();
                        }
                    }
                });
                workers[i].start();
            }
            go.countDown();
            for (int s = 0; s < stagger * producers / 2; s++) { Thread.yield(); }
            closed[0] = true;
            NtsEnv.close(env);
            for (Thread w : workers) { w.join(); }
        } catch (NtsRefusal leaked) {
            check(false, "close reported a leak: " + leaked.getMessage());
        } finally {
            NtsEnv.leaveEnv(env, previous);
        }
        check(ranAfterClose.get() == 0, ranAfterClose.get() + " completions ran after close");
        check(threw.get() == 0, threw.get() + " posts hit a slot that had already been returned");
        check(NtsEnv.outstanding(env) == 0.0,
            "close left " + NtsEnv.outstanding(env) + " outstanding");
        check(NtsInbox.available(NtsEnv.inbox(env)) == NtsInbox.capacity(NtsEnv.inbox(env)),
            "close returned " + NtsInbox.available(NtsEnv.inbox(env)) + " of "
                + NtsInbox.capacity(NtsEnv.inbox(env)) + " credits");
    }

    public static void main(String[] args) throws Exception {
        int rounds = args.length > 0 ? Integer.parseInt(args[0]) : 60;
        for (int round = 0; round < rounds; round++) {
            // Vary both the width of the race and where close lands in it.
            race(4 + (round % 5) * 3, round % 7);
        }
        System.out.printf("close race: %d rounds, no late completion, every credit returned -- %d checks, %d failures%n",
            rounds, checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
