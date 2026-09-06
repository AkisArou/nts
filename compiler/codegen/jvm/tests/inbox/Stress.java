import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import nts.rt.NtsInbox;
import nts.rt.NtsRefusal;
import nts.rt.NtsResumable;

/**
 * Many producers, one consumer, and the two properties that matter:
 * every byte a producer wrote before posting is visible after receipt, and
 * every credit comes back exactly once however the work ended.
 */
public final class Stress {
    static int failures;

    static void fail(String what) {
        failures++;
        if (failures < 6) { System.out.println("FAILED: " + what); }
    }

    /**
     * The publication property.
     *
     * <p>Each producer fills a private region of one shared array with a
     * pattern derived from its index, then posts. The consumer verifies every
     * byte. With the volatile link in place this always passes; **without it,
     * a weakly ordered machine can show the consumer a region still full of
     * zeros**, and that is the failure this exists to catch on a device. On
     * x86 it will pass either way, which is exactly why the plan requires it
     * to run on real ARM hardware rather than only here.
     */
    static void publication(int producers, int rounds, int region) throws Exception {
        byte[] shared = new byte[producers * region];
        NtsInbox inbox = NtsInbox.withCapacity(producers * 2);
        AtomicInteger delivered = new AtomicInteger();
        AtomicInteger torn = new AtomicInteger();
        for (int round = 0; round < rounds; round++) {
            final int stamp = round + 1;
            CountDownLatch ready = new CountDownLatch(1);
            CountDownLatch done = new CountDownLatch(producers);
            java.util.List<Thread> threads = new java.util.ArrayList<Thread>();
            final java.util.concurrent.ConcurrentLinkedQueue<NtsInbox.Slot> posted =
                new java.util.concurrent.ConcurrentLinkedQueue<NtsInbox.Slot>();
            for (int p = 0; p < producers; p++) {
                final int who = p;
                Thread t = new Thread(new Runnable() {
                    @Override public void run() {
                        NtsInbox.Slot slot = NtsInbox.reserve(inbox);
                        if (slot == null) { done.countDown(); return; }
                        try { ready.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                        int base = who * region;
                        // Plain writes. Their visibility is the inbox's job.
                        for (int i = 0; i < region; i++) { shared[base + i] = (byte) (stamp + who + i); }
                        NtsInbox.post(slot, new NtsResumable() {
                            @Override public void resume() {
                                for (int i = 0; i < region; i++) {
                                    if (shared[base + i] != (byte) (stamp + who + i)) { torn.incrementAndGet(); return; }
                                }
                                delivered.incrementAndGet();
                            }
                        });
                        posted.add(slot);
                        done.countDown();
                    }
                });
                threads.add(t);
                t.start();
            }
            ready.countDown();
            done.await();
            // Drain until every producer's completion has been seen. A gap is
            // transient, not terminal, so this retries rather than spinning
            // inside the inbox.
            int seen = 0;
            long deadline = System.nanoTime() + 10_000_000_000L;
            while (seen < producers && System.nanoTime() < deadline) { seen += NtsInbox.drain(inbox); }
            if (seen != producers) { fail("round " + round + " delivered " + seen + " of " + producers); }
            for (Thread t : threads) { t.join(); }
        }
        if (torn.get() != 0) { fail(torn.get() + " completions saw bytes written before the post"); }
        if (delivered.get() != producers * rounds) {
            fail("delivered " + delivered.get() + " of " + (producers * rounds));
        }
        if (NtsInbox.available(inbox) != NtsInbox.capacity(inbox)) {
            fail("credits leaked: " + NtsInbox.available(inbox) + " of " + NtsInbox.capacity(inbox));
        }
    }

    /** The ceiling is reached before the work exists, never after. */
    static void ceiling() {
        NtsInbox inbox = NtsInbox.withCapacity(3);
        NtsInbox.Slot a = NtsInbox.reserve(inbox);
        NtsInbox.Slot b = NtsInbox.reserve(inbox);
        NtsInbox.Slot c = NtsInbox.reserve(inbox);
        if (NtsInbox.reserve(inbox) != null) { fail("reserved past the ceiling"); }
        NtsInbox.abandon(a);
        if (NtsInbox.reserve(inbox) == null) { fail("an abandoned credit did not come back"); }
        NtsInbox.post(b, null);
        NtsInbox.drain(inbox);
        if (NtsInbox.reserve(inbox) == null) { fail("a delivered credit did not come back"); }
        NtsInbox.abandon(c);
    }

    /** Close drops what it cannot deliver and still returns every obligation. */
    static void closeReturnsEverything() {
        NtsInbox inbox = NtsInbox.withCapacity(8);
        for (int i = 0; i < 5; i++) { NtsInbox.post(NtsInbox.reserve(inbox), null); }
        NtsInbox.Slot held = NtsInbox.reserve(inbox);
        int dropped = NtsInbox.discard(inbox);
        if (dropped != 5) { fail("discard returned " + dropped + " of 5"); }
        NtsInbox.abandon(held);
        if (NtsInbox.available(inbox) != 8) {
            fail("after close, " + NtsInbox.available(inbox) + " of 8 credits");
        }
    }

    /** Returning a slot twice is a defect, not a silent double credit. */
    static void doubleReturnRefused() {
        NtsInbox inbox = NtsInbox.withCapacity(2);
        NtsInbox.Slot slot = NtsInbox.reserve(inbox);
        NtsInbox.abandon(slot);
        try {
            NtsInbox.abandon(slot);
            fail("a slot was returned twice without refusing");
        } catch (NtsRefusal expected) {
            // The point.
        }
        if (NtsInbox.available(inbox) != 2) { fail("a double return changed the credit count"); }
    }

    /**
     * The declaration that makes the publication property true, asserted where
     * the property itself cannot be.
     *
     * <p>The stress above passes on x86 whether or not the link is volatile,
     * because x86 does not reorder stores. So the behavioural test is only
     * meaningful on ARM — and the *declaration* is checkable everywhere. If
     * someone removes `volatile` as an optimization, this fails on the machine
     * they are sitting at rather than on a device six weeks later.
     *
     * <p>An untestable invariant with a testable cause is worth asserting at
     * the cause.
     */
    static void linkIsVolatile() throws Exception {
        java.lang.reflect.Field link = NtsInbox.Slot.class.getDeclaredField("next");
        if (!java.lang.reflect.Modifier.isVolatile(link.getModifiers())) {
            fail("NtsInbox.Slot.next is not volatile: the publication edge is gone");
        }
    }

    public static void main(String[] args) throws Exception {
        linkIsVolatile();
        int producers = args.length > 0 ? Integer.parseInt(args[0]) : 16;
        int rounds = args.length > 1 ? Integer.parseInt(args[1]) : 200;
        publication(producers, rounds, 512);
        ceiling();
        closeReturnsEverything();
        doubleReturnRefused();
        System.out.printf("%d producers x %d rounds published, credits balanced, %d failures%n",
            producers, rounds, failures);
        if (failures != 0) { System.exit(1); }
    }
}
