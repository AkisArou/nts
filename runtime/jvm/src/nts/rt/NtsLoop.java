package nts.rt;

/**
 * The event loop's two queues and the checkpoint that drains them.
 *
 * <p><b>Not `CompletableFuture`, and `docs/async.md` says why in one line:</b>
 * "handing that to a platform primitive with different ordering changes what
 * programs print". Promise semantics, microtasks and ticks are the runtime's,
 * per runtime family, and there are two families -- native and JVM. The
 * algorithm below is not reasoned-to; it is what node does, and the record of
 * verifying it is a program that queues a timer, an immediate, a tick, and a
 * microtask that enqueues a second tick.
 *
 * <p>Depth rather than a flag, because a capability may re-enter TypeScript
 * synchronously and only the outermost return is a checkpoint.
 *
 * <p>The two-queue shape is not a Node special case bolted on: a profile that
 * never enqueues a tick makes the inner loop a no-op and this *is* the
 * ECMAScript checkpoint. Adding `nextTick` later would have changed the
 * ordering of programs that already worked.
 */
public final class NtsLoop {
    private NtsLoop() {}

    private static final java.util.ArrayDeque<NtsResumable> MICROTASKS =
        new java.util.ArrayDeque<>();
    private static final java.util.ArrayDeque<NtsResumable> TICKS =
        new java.util.ArrayDeque<>();
    private static int depth;

    public static void enter() {
        depth++;
    }

    public static void leave() {
        depth--;
        if (depth == 0) {
            checkpoint();
        }
    }

    public static void microtask(NtsResumable task) {
        MICROTASKS.addLast(task);
    }

    public static void tick(NtsResumable task) {
        TICKS.addLast(task);
    }

    /**
     * The checkpoint, verbatim from `docs/async.md` section 3.
     *
     * <p>The outer loop is what makes a tick enqueued *by a microtask* run in a
     * second pass of the same checkpoint rather than in the next macrotask --
     * one of the two details tests already depend on.
     */
    private static void checkpoint() {
        do {
            NtsResumable tick;
            while ((tick = TICKS.pollFirst()) != null) {
                tick.resume();
            }
            NtsResumable micro;
            while ((micro = MICROTASKS.pollFirst()) != null) {
                micro.resume();
            }
        } while (!TICKS.isEmpty());
    }

    /**
     * Run one queued task, and say whether there was one.
     *
     * <p>Ticks before microtasks, which is the checkpoint's order and not an
     * arbitrary choice. The harness needs this rather than {@link #drain()}
     * because it runs the loop *until a particular promise settles*, not until
     * the loop falls quiet -- `await` on node returns when its promise does,
     * and the two differ as soon as timers exist: a program that left another
     * timer pending would have it fire on this side and not on node's.
     */
    public static boolean step() {
        NtsResumable next = TICKS.pollFirst();
        if (next == null) {
            next = MICROTASKS.pollFirst();
        }
        if (next == null) {
            return false;
        }
        next.resume();
        return true;
    }

    /**
     * Run everything queued, for a program whose `main` has returned.
     *
     * <p>A compiled program's entry point is not inside an `enter`/`leave`
     * pair, so nothing would drain the queues on the way out and an `async`
     * function's continuation would never run. This is that drain, and it is
     * the whole of what a host would otherwise provide.
     */
    public static void drain() {
        depth = 1;
        leave();
    }
}
