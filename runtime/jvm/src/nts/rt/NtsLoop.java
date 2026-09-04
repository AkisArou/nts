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

    /**
     * One pending timer.
     *
     * <p>`due` and `seq` together are the order: `docs/async.md` requires
     * timers in delay order with equal deadlines in creation order, and the
     * same document records the one time two hosts disagreed about exactly
     * this. `seq` never resets, so two timers created in the same virtual
     * millisecond keep the order they were written in.
     */
    private static final class Timer {
        final double due;
        final long seq;
        final double id;
        final NtsCallback callback;
        final boolean repeating;
        final double interval;

        Timer(double due, long seq, double id, NtsCallback callback, boolean repeating, double interval) {
            this.due = due;
            this.seq = seq;
            this.id = id;
            this.callback = callback;
            this.repeating = repeating;
            this.interval = interval;
        }
    }

    // A list rather than a PriorityQueue: `clearTimeout` removes by id, and a
    // heap makes that a linear scan anyway. A program with enough pending
    // timers for this to matter is not one this compiler has met.
    private static final java.util.ArrayList<Timer> TIMERS = new java.util.ArrayList<>();
    private static double now;
    private static long sequence;
    private static double nextId = 1.0;

    /**
     * Whole milliseconds, floored at zero and capped at 2^53-1.
     *
     * <p>A transliteration of `nts_delay`, and it is in the *runtime* rather
     * than in the loop for the reason `docs/async.md` gives: each host
     * converting the delay itself made "milliseconds" mean two things, and
     * `setTimeout(a, 1.5); setTimeout(b, 1.0)` came out in opposite orders on
     * two hosts of the same program. NaN floors to zero, because `!(x > 0)` is
     * true of it -- which is what the C expression says and what node does.
     */
    static double delay(double milliseconds) {
        if (!(milliseconds > 0.0)) {
            return 0.0;
        }
        if (milliseconds > 9007199254740991.0) {
            return 9007199254740991.0;
        }
        return Math.floor(milliseconds);
    }

    /** Queue a timer and return the id `clearTimeout` will name it by. */
    public static double postDelayed(NtsCallback callback, double milliseconds, boolean repeating) {
        double wait = delay(milliseconds);
        double id = nextId;
        nextId += 1.0;
        TIMERS.add(new Timer(now + wait, sequence++, id, callback, repeating, wait));
        return id;
    }

    /**
     * Cancel a timer.
     *
     * <p>An id that already fired, or one from another turn, is a no-op --
     * which is what `clearTimeout` specifies and what the ordering contract in
     * `docs/async.md` names: "an id that was never issued disturbing nothing".
     */
    public static void cancelDelayed(double id) {
        for (int at = 0; at < TIMERS.size(); at++) {
            if (TIMERS.get(at).id == id) {
                TIMERS.remove(at);
                return;
            }
        }
    }

    /** The earliest pending timer, or `null`. */
    private static Timer earliest() {
        Timer best = null;
        for (Timer timer : TIMERS) {
            if (best == null || timer.due < best.due
                    || (timer.due == best.due && timer.seq < best.seq)) {
                best = timer;
            }
        }
        return best;
    }

    /**
     * Advance virtual time to the earliest deadline and run that one timer.
     *
     * <p>The clock *advances*: `docs/async.md` is explicit that a fake clock
     * which only ticks when told strands every `setTimeout`. One timer per
     * call rather than every timer at that deadline, because a checkpoint runs
     * between tasks and firing two before it would put a microtask queued by
     * the first behind the second.
     */
    private static boolean fireEarliest() {
        Timer timer = earliest();
        if (timer == null) {
            return false;
        }
        TIMERS.remove(timer);
        if (timer.due > now) {
            now = timer.due;
        }
        if (timer.repeating) {
            TIMERS.add(new Timer(now + timer.interval, sequence++, timer.id, timer.callback, true,
                timer.interval));
        }
        timer.callback.call();
        return true;
    }

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
            // Nothing runnable. A pending timer is still work, and the clock
            // moves to reach it -- the harness runs the loop until a promise
            // settles, and a promise settled by a timer would otherwise never
            // be reached.
            return fireEarliest();
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
        // A complete checkpoint between every pair of timers, which is the
        // ordering `docs/async.md` section 3 specifies and the reason this is
        // a loop rather than a sweep of the queue.
        while (fireEarliest()) {
            depth = 1;
            leave();
        }
    }
}
