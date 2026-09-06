package nts.rt;

import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.concurrent.locks.LockSupport;

/**
 * One execution environment: its queues, timers, clock, external liveness and
 * close state.
 *
 * <h2>Why this is an object and `NtsLoop` was not</h2>
 *
 * `NtsLoop` held every one of these in a static, which is the assumption that a
 * process has exactly one environment. That is true today and is false the
 * moment a Worker exists or an embedder runs two runtimes — and on Android an
 * embedder is the normal case. `runtime/c` had the identical shape, in the same
 * place, for the same reason: two symptoms of one missing seam rather than a
 * JVM quirk.
 *
 * <h2>What is atomic and what is not, and why that is a decision</h2>
 *
 * Exactly one lane mutates ordinary environment state. Queues, the timer heap,
 * the depth counter and the liveness count are therefore **plain fields with
 * plain arithmetic** — no atomics, no locks, no volatile. That is not an
 * oversight to fix later; it is what the one-owner-lane rule buys, and making
 * them atomic would pay for a guarantee already held.
 *
 * <p>The exception is the {@linkplain NtsInbox inbox}, which foreign threads
 * write to and which is atomic precisely because it is the only thing they may
 * touch. Everything crossing the boundary crosses there.
 *
 * <h2>Virtual and monotonic time are modes, not an implementation detail</h2>
 *
 * The differential is deterministic against node **because** virtual time
 * advances by jumping to the earliest due timer: no wall clock, no scheduler,
 * the same interleaving every run. Real network I/O cannot work that way. So an
 * environment picks its clock at construction and every test states which kind
 * it is — oracle tests on virtual time, liveness tests on monotonic. An
 * environment that silently advanced virtual time on a network event would make
 * the oracle non-deterministic without anyone choosing to give that up.
 */
public final class NtsEnv {
    /** Deterministic: time is what the earliest timer says it is. */
    public static final double VIRTUAL = 0.0;
    /** Real: time is `System.nanoTime`, and the lane waits rather than jumps. */
    public static final double MONOTONIC = 1.0;

    /**
     * The environment the calling lane is inside.
     *
     * <p>A `ThreadLocal` because the alternative — a hidden parameter on every
     * generated method — is a backend calling convention that has to be
     * measured before it is chosen, and the contract leaves the mechanism to
     * the provider for exactly that reason. This is the facade the plan
     * sanctions; it is read at lane entry, not per operation.
     */
    private static final ThreadLocal<NtsEnv> CURRENT = new ThreadLocal<NtsEnv>();

    /**
     * The environment a lane gets when nobody made one.
     *
     * <p>Created on first use rather than at host installation, because
     * allocation, promises and top-level code all run before any host exists:
     * an environment that came into being with the host would have nothing for
     * top-level code to allocate into. `runtime/c` reaches the same conclusion
     * from its own four host-guarded entry points. Environment first, host into
     * it.
     */
    private static NtsEnv fallback;

    private static final class Timer {
        double due;
        long seq;
        final double id;
        final NtsCallback callback;
        final boolean repeating;
        final double interval;
        int heapIndex;
        Timer(double due, long seq, double id, NtsCallback callback, boolean repeating, double interval) {
            this.due = due;
            this.seq = seq;
            this.id = id;
            this.callback = callback;
            this.repeating = repeating;
            this.interval = interval;
        }
    }

    private static final Timer[] EMPTY_TIMERS = new Timer[0];
    /** Enough outstanding operations for any real client; see `NtsInbox`. */
    private static final int DEFAULT_INBOX = 1024;

    // ArrayDeque stores references without allocating a node per enqueue.
    private final ArrayDeque<NtsResumable> microtasks = new ArrayDeque<NtsResumable>();
    private final ArrayDeque<NtsResumable> ticks = new ArrayDeque<NtsResumable>();
    private int depth;

    private Timer[] heap = EMPTY_TIMERS;
    /** Open addressing by numeric timer id: no `Double` keys or HashMap nodes. */
    private Timer[] byId = EMPTY_TIMERS;
    private int size;
    private int idThreshold;
    private double now;
    private long sequence;
    private double nextId = 1.0;

    private final boolean monotonic;
    private final long origin;
    private final NtsInbox inbox;
    /** External work launched and not yet delivered, cancelled or dropped. */
    private int outstanding;
    private boolean closed;

    private NtsEnv(boolean monotonic, int inboxCapacity) {
        this.monotonic = monotonic;
        this.origin = monotonic ? System.nanoTime() : 0L;
        this.inbox = NtsInbox.withCapacity(inboxCapacity);
    }

    public static NtsEnv create(double timeMode) { return create(timeMode, DEFAULT_INBOX); }

    public static NtsEnv create(double timeMode, double inboxCapacity) {
        return new NtsEnv(timeMode == MONOTONIC, (int) inboxCapacity);
    }

    /** The environment this lane is inside, creating the default if none is. */
    public static NtsEnv current() {
        NtsEnv here = CURRENT.get();
        if (here != null) { return here; }
        if (fallback == null) { fallback = new NtsEnv(false, DEFAULT_INBOX); }
        CURRENT.set(fallback);
        NtsInbox.ownedBy(fallback.inbox, Thread.currentThread());
        return fallback;
    }

    /**
     * Make this environment current for the calling lane and claim the lane.
     *
     * <p>Returns what was current, for {@link #leaveEnv} to restore. Scoped
     * rather than set-once, so a host that runs two environments on one thread
     * cannot leave the second one installed.
     */
    public static NtsEnv enterEnv(NtsEnv env) {
        NtsEnv previous = CURRENT.get();
        CURRENT.set(env);
        NtsInbox.ownedBy(env.inbox, Thread.currentThread());
        return previous;
    }

    /**
     * Restore what {@link #enterEnv} displaced, and stop being the wake target.
     *
     * <p>Clearing matters more than restoring: a `ThreadLocal` still holding a
     * closed environment keeps it, its queues and every callback it retains
     * alive for the whole life of the thread. That is the classic Android leak
     * and it is why the contract says scoped state is cleared on leave.
     */
    public static void leaveEnv(NtsEnv env, NtsEnv previous) {
        NtsInbox.ownedBy(env.inbox, null);
        if (previous == null) { CURRENT.remove(); } else { CURRENT.set(previous); }
    }

    public static boolean isMonotonic(NtsEnv env) { return env.monotonic; }
    public static NtsInbox inbox(NtsEnv env) { return env.inbox; }
    public static boolean isClosed(NtsEnv env) { return env.closed; }
    public static double outstanding(NtsEnv env) { return env.outstanding; }

    /** Milliseconds since this environment's origin. */
    public static double now(NtsEnv env) {
        if (!env.monotonic) { return env.now; }
        return (System.nanoTime() - env.origin) / 1_000_000.0;
    }

    // --- external work ------------------------------------------------------

    /**
     * Take a completion credit and count one unit of liveness, or refuse.
     *
     * <p>Both obligations are taken **before** the platform work exists, which
     * is the only point at which backpressure can be applied without either
     * blocking a lane or dropping a completion already counted. A null answer
     * means the caller must reject or delay rather than launch.
     */
    public static NtsInbox.Slot launch(NtsEnv env) {
        if (env.closed) { throw new NtsRefusal("launching external work on a closed environment"); }
        NtsInbox.Slot slot = NtsInbox.reserve(env.inbox);
        if (slot != null) { env.outstanding++; }
        return slot;
    }

    /**
     * Return a launch's obligations without delivering it: cancellation, or a
     * platform call that failed before it could complete.
     */
    public static void cancel(NtsEnv env, NtsInbox.Slot slot) {
        NtsInbox.abandon(slot);
        env.outstanding--;
    }

    /** Run every completion published so far. Owner lane only. */
    public static double deliver(NtsEnv env) {
        int ran = NtsInbox.drain(env.inbox);
        env.outstanding -= ran;
        if (ran > 0) { checkpoint(env); }
        return ran;
    }

    // --- timers -------------------------------------------------------------

    static double delay(double milliseconds) {
        if (!(milliseconds > 0.0)) { return 0.0; }
        return milliseconds > 9007199254740991.0 ? 9007199254740991.0 : Math.floor(milliseconds);
    }

    public static double postDelayed(NtsEnv env, NtsCallback callback, double ms, boolean repeating) {
        if (env.nextId > 9007199254740991.0) { throw new NtsRefusal("timer id space exhausted"); }
        if (env.size == env.heap.length) {
            env.heap = Arrays.copyOf(env.heap, NtsArrays.growCapacity(env.heap.length, env.size + 1));
        }
        if (env.size >= env.idThreshold) { env.growIdIndex(); }
        double wait = delay(ms);
        double id = env.nextId++;
        Timer timer = new Timer(now(env) + wait, env.sequence++, id, callback, repeating, wait);
        int bucket = idHash(id) & (env.byId.length - 1);
        while (env.byId[bucket] != null) { bucket = (bucket + 1) & (env.byId.length - 1); }
        env.byId[bucket] = timer;
        env.siftUp(env.size++, timer);
        return id;
    }

    public static void cancelDelayed(NtsEnv env, double id) {
        int bucket = env.findId(id);
        if (bucket < 0) { return; }
        Timer timer = env.byId[bucket];
        env.removeId(bucket);
        env.removeHeap(timer.heapIndex);
    }

    private static int idHash(double id) {
        long x = (long) id;
        int h = (int) (x ^ (x >>> 32));
        h ^= h >>> 16;
        h *= 0x7feb352d;
        h ^= h >>> 15;
        return h;
    }

    private int findId(double id) {
        if (size == 0 || !(id >= 1.0) || id > 9007199254740991.0 || id != (long) id) { return -1; }
        int mask = byId.length - 1;
        int p = idHash(id) & mask;
        for (;;) {
            Timer timer = byId[p];
            if (timer == null) { return -1; }
            if (timer.id == id) { return p; }
            p = (p + 1) & mask;
        }
    }

    private void growIdIndex() {
        if (byId.length >= (1 << 30)) { throw new OutOfMemoryError("timer index capacity exhausted"); }
        int capacity = byId.length == 0 ? 16 : byId.length << 1;
        Timer[] replacement = new Timer[capacity];
        int mask = capacity - 1;
        for (int i = 0; i < size; i++) {
            Timer timer = heap[i];
            int p = idHash(timer.id) & mask;
            while (replacement[p] != null) { p = (p + 1) & mask; }
            replacement[p] = timer;
        }
        byId = replacement;
        idThreshold = capacity - (capacity >>> 2);
    }

    private void removeId(int hole) {
        int mask = byId.length - 1;
        int scan = (hole + 1) & mask;
        Timer timer;
        while ((timer = byId[scan]) != null) {
            int home = idHash(timer.id) & mask;
            if (((scan - home) & mask) >= ((scan - hole) & mask)) {
                byId[hole] = timer;
                hole = scan;
            }
            scan = (scan + 1) & mask;
        }
        byId[hole] = null;
    }

    private static boolean before(Timer a, Timer b) {
        return a.due < b.due || (a.due == b.due && a.seq < b.seq);
    }

    private void siftUp(int at, Timer timer) {
        while (at > 0) {
            int parent = (at - 1) >>> 1;
            Timer above = heap[parent];
            if (!before(timer, above)) { break; }
            heap[at] = above;
            above.heapIndex = at;
            at = parent;
        }
        heap[at] = timer;
        timer.heapIndex = at;
    }

    private void siftDown(int at, Timer timer) {
        int half = size >>> 1;
        while (at < half) {
            int child = (at << 1) + 1;
            if (child + 1 < size && before(heap[child + 1], heap[child])) { child++; }
            Timer below = heap[child];
            if (!before(below, timer)) { break; }
            heap[at] = below;
            below.heapIndex = at;
            at = child;
        }
        heap[at] = timer;
        timer.heapIndex = at;
    }

    private void removeHeap(int at) {
        Timer removed = heap[at];
        int last = --size;
        Timer moved = heap[last];
        heap[last] = null;
        removed.heapIndex = -1;
        if (at < last) {
            if (at > 0 && before(moved, heap[(at - 1) >>> 1])) { siftUp(at, moved); }
            else { siftDown(at, moved); }
        }
    }

    /**
     * Fire the earliest timer, or report that there is none.
     *
     * <p>In virtual time the clock **jumps** to the due moment: that is what
     * makes a run reproducible. In monotonic time it cannot, so the caller
     * waits instead -- see {@link #waitUntilDue}.
     */
    private boolean fireEarliest() {
        if (size == 0) { return false; }
        Timer timer = heap[0];
        if (!monotonic) {
            if (timer.due > now) { now = timer.due; }
        } else if (timer.due > now(this)) {
            return false;
        }
        if (timer.repeating) {
            // Re-arm before the callback, so `clearInterval` inside it cancels
            // the next occurrence. The same Timer is reused rather than
            // reallocated -- and a repeating handle holds its callback for the
            // handle's lifetime, which is what the completion contract means by
            // one liveness unit per handle rather than per notification.
            timer.due = now(this) + timer.interval;
            timer.seq = sequence++;
            siftDown(0, timer);
        } else {
            removeId(findId(timer.id));
            removeHeap(0);
        }
        timer.callback.call();
        return true;
    }

    /** Milliseconds until the earliest timer, or -1 when there is none. */
    private double untilDue() {
        if (size == 0) { return -1.0; }
        double wait = heap[0].due - now(this);
        return wait > 0.0 ? wait : 0.0;
    }

    // --- lanes and checkpoints ---------------------------------------------

    public static void enter(NtsEnv env) { env.depth++; }

    public static void leave(NtsEnv env) {
        if (--env.depth == 0) { checkpoint(env); }
    }

    public static void microtask(NtsEnv env, NtsResumable task) { env.microtasks.addLast(task); }

    public static void tick(NtsEnv env, NtsResumable task) { env.ticks.addLast(task); }

    private static void checkpoint(NtsEnv env) {
        do {
            NtsResumable task;
            while ((task = env.ticks.pollFirst()) != null) { task.resume(); }
            while ((task = env.microtasks.pollFirst()) != null) { task.resume(); }
        } while (!env.ticks.isEmpty());
    }

    /** One unit of progress: a queued task, a due timer, or a completion. */
    public static boolean step(NtsEnv env) {
        NtsResumable next = env.ticks.pollFirst();
        if (next == null) { next = env.microtasks.pollFirst(); }
        if (next != null) { next.resume(); return true; }
        if (NtsInbox.drain(env.inbox) > 0) { return true; }
        return env.fireEarliest();
    }

    /**
     * Run to quiescence.
     *
     * <p>In virtual time quiescence is "no task and no timer", reached by
     * jumping. In monotonic time it is that **and no outstanding external
     * work**: a lane with a socket read in flight is not idle, it is waiting,
     * and exiting would be the liveness bug the contract is written against.
     */
    public static void drain(NtsEnv env) {
        env.depth = 1;
        leave(env);
        for (;;) {
            if (deliver(env) > 0) { continue; }
            if (env.fireEarliest()) {
                env.depth = 1;
                leave(env);
                continue;
            }
            if (!env.monotonic) { return; }
            // Quiescence in real time is "nothing queued, no timer pending,
            // and nothing outstanding". Testing only the outstanding count
            // returns immediately from a lane whose only work is a timer that
            // is not due yet -- which reads as an idle environment and is a
            // timer that never fires.
            if (env.outstanding == 0 && env.size == 0) { return; }
            env.waitUntilDue();
        }
    }

    /**
     * Park until the earliest timer is due or a completion arrives.
     *
     * <p>`parkNanos` rather than a lock: the wake comes from
     * {@link NtsInbox#post}, which must not block or allocate, and `unpark` is
     * the only primitive that satisfies both. A spurious wake costs one turn of
     * the loop above, which is why the loop re-checks rather than trusting it.
     */
    private void waitUntilDue() {
        double wait = untilDue();
        if (wait < 0.0) {
            LockSupport.park(this);
        } else {
            LockSupport.parkNanos(this, (long) Math.min(wait * 1_000_000.0, 1e15));
        }
    }

    /**
     * Stop accepting work, drop what cannot be delivered, and return every
     * obligation.
     *
     * <p>A zero liveness count is not by itself proof that callbacks and
     * storage were retired, which is why this drops explicitly rather than
     * waiting for the count to fall on its own -- and why the reachability
     * test, not this counter, is what proves a closed environment stopped
     * holding its callbacks.
     */
    public static void close(NtsEnv env) {
        if (env.closed) { return; }
        env.closed = true;
        // Reclaim rather than drain: work still running on an I/O thread holds
        // a credit, and a single drain walks past it. `reclaim` alternates
        // until every credit is back, bounded, and reports what it could not
        // recover instead of pretending.
        int leaked = NtsInbox.reclaim(env.inbox, 2000.0);
        env.outstanding = leaked;
        if (leaked != 0) {
            throw new NtsRefusal(
                "closing left " + leaked + " completion credit(s) held by work that never settled"
            );
        }
        env.microtasks.clear();
        env.ticks.clear();
        for (int i = 0; i < env.size; i++) { env.heap[i] = null; }
        Arrays.fill(env.byId, null);
        env.heap = EMPTY_TIMERS;
        env.byId = EMPTY_TIMERS;
        env.size = 0;
        env.idThreshold = 0;
    }
}
