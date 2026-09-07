import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

import nts.rt.NtsEnv;
import nts.rt.NtsRefusal;

/**
 * There is one default environment, and one lane owns it.
 *
 * <p>`NtsEnv.current()` answers for a thread that entered no environment --
 * which `runtime/c` also has, as `nts_environment_current`, "never null: a
 * program that never asks for one still has exactly one". Singular there, and
 * it was not singular here.
 *
 * <p>The lazy initializer was `if (fallback == null) { fallback = new
 * NtsEnv(...); }` on a plain static, which is the textbook unsafe singleton.
 * It was not theoretical: **64 threads racing this produced 56 to 62 distinct
 * environments** on every run, near enough one each. A completion submitted
 * against one and drained from another goes to an inbox nobody reads, and
 * nothing anywhere reports it.
 *
 * <p>Two properties, and the second is a design decision rather than a repair.
 * There must be exactly **one** environment however many lanes ask; and the
 * second lane must be **refused by name** rather than handed a share, because
 * `NtsInbox.post` wakes the inbox's owner and two lanes on one inbox means one
 * of them parks in `drain` holding work it will never be told about. A hang
 * that points nowhere is worse than a message.
 *
 * <p>What this cannot test is the publication half: a thread seeing a non-null
 * reference to an object whose fields are not written yet needs hardware that
 * reorders, which is `docs/records/0181`. The class holder makes it
 * unreachable by construction -- the JVM initializes a class once, under its
 * own lock -- so there is nothing left for a barrier to get wrong.
 */
public final class DefaultLaneTest {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    public static void main(String[] args) throws Exception {
        // This thread first, and deliberately: whoever calls `current()` first
        // owns the default, so racing sixty-four lanes for it and then asking
        // from here makes *this* thread the sixty-fifth and refused. Claiming
        // it up front makes the rest of the test deterministic -- every other
        // lane must be refused, with no question of which one won.
        NtsEnv mine = NtsEnv.current();
        check(mine == NtsEnv.current(),
            "the owning lane got two different environments on two calls");

        final int lanes = 64;
        final CountDownLatch go = new CountDownLatch(1);
        final CountDownLatch done = new CountDownLatch(lanes);
        final Set<NtsEnv> seen = Collections.newSetFromMap(
            Collections.synchronizedMap(new IdentityHashMap<NtsEnv, Boolean>()));
        final AtomicInteger admitted = new AtomicInteger();
        final AtomicInteger refused = new AtomicInteger();
        final AtomicInteger wrong = new AtomicInteger();

        for (int i = 0; i < lanes; i++) {
            Thread lane = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        go.await();
                        seen.add(NtsEnv.current());
                        admitted.incrementAndGet();
                    } catch (NtsRefusal expected) {
                        // Only the message this case is about. A refusal for
                        // some other reason would otherwise count as a pass.
                        if (expected.getMessage().contains("belongs to another lane")) {
                            refused.incrementAndGet();
                        } else {
                            wrong.incrementAndGet();
                        }
                    } catch (InterruptedException stop) {
                        Thread.currentThread().interrupt();
                    } finally {
                        done.countDown();
                    }
                }
            }, "default-lane-" + i);
            lane.setDaemon(true);
            lane.start();
        }
        go.countDown();
        done.await();

        seen.add(mine);
        check(seen.size() == 1,
            seen.size() + " distinct default environments rather than 1. The lazy "
                + "initializer is unsafe again, and a completion submitted against one "
                + "and drained from another goes to an inbox nobody reads.");
        check(admitted.get() == 0,
            admitted.get() + " other lanes were admitted rather than 0");
        check(refused.get() == lanes,
            refused.get() + " lanes were refused rather than " + lanes);
        check(wrong.get() == 0, wrong.get() + " lanes were refused for another reason");

        System.out.printf("default lane: %d environment(s), %d other lanes admitted, "
            + "%d refused -- %d checks, %d failures%n",
            seen.size(), admitted.get(), refused.get(), checks, failures);
        if (failures != 0) {
            System.exit(1);
        }
    }
}
