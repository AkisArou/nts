package nts.rt;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;

/**
 * The one route by which a foreign thread reaches an environment.
 *
 * <p>Many producers, one consumer, bounded by reservations taken before the
 * work that will complete into it exists.
 *
 * <h2>Why reservation and ordering are separate things</h2>
 *
 * The completion contract requires that posting cannot fail, drop, block, or
 * allocate. The obvious way to get that is a fixed array of cells claimed by an
 * atomic index — and it is wrong here, because **the order work is launched in
 * is not the order it completes in**. A slot claimed by a read that takes two
 * seconds would sit in front of a write that finished in two milliseconds, and
 * the consumer, walking cells in claim order, would not see the second until
 * the first arrived. Head-of-line blocking, in a queue whose entire job is to
 * deliver completions promptly.
 *
 * <p>So the credit and the queue are separate. A **credit** is a permit taken
 * before launching, which bounds how much can ever be outstanding; the **queue**
 * is an intrusive wait-free MPSC list whose node was allocated when the credit
 * was taken. Posting links an existing node — no allocation, no failure path,
 * and no dependence on the order the credits were issued.
 *
 * <h2>The publication edge</h2>
 *
 * A producer writes {@link Slot#work} and then links the node with a volatile
 * write; the consumer reads the link with a volatile read before touching
 * `work`. Under the Java Memory Model that pair is the happens-before edge
 * that makes the producer's earlier writes — including bytes written into a
 * shared buffer — visible to the owner lane.
 *
 * <p>**This is the only sanctioned handoff.** A wrapper or its backing passed to
 * another environment by any other route has no edge, and on a weakly ordered
 * machine the reader may observe stale bytes indefinitely with no race in the
 * JavaScript sense. On x86 it will appear to work. Android is ARM.
 */
public final class NtsInbox {
    /** A reservation, and the queue node it becomes when posted. */
    public static final class Slot {
        /** Volatile: the release half of the publication edge. */
        volatile Slot next;
        /** Written before the link, read after it. */
        NtsResumable work;
        /** The inbox that issued it, so a return cannot be misdirected. */
        volatile NtsInbox owner;

        @Override public String toString() {
            return "completion slot@" + Integer.toHexString(System.identityHashCode(this));
        }
    }

    private final AtomicReference<Slot> tail;
    /** Consumer-only; never touched by a producer. */
    private Slot head;
    private final AtomicInteger credits;
    private final int capacity;
    /**
     * The lane to wake when a completion arrives, or null while nothing parks.
     *
     * <p>Set once by the owner before any producer exists, so it needs no
     * synchronization of its own: the same publication edge that makes the
     * producer's writes visible makes this visible to the producer.
     */
    private volatile Thread owner;
    /**
     * Set once, by {@link #reclaim}, before it starts taking credits back.
     *
     * <p>Volatile because a producer on an I/O thread reads it, and the whole
     * point is that the producer sees it promptly.
     */
    private volatile boolean closed;

    private NtsInbox(int capacity) {
        this.capacity = capacity;
        this.credits = new AtomicInteger(capacity);
        Slot stub = new Slot();
        this.head = stub;
        this.tail = new AtomicReference<Slot>(stub);
    }

    /**
     * A bounded inbox.
     *
     * <p>The bound is the ceiling on outstanding external work, not a guess at
     * throughput: a completion cannot exist without a credit, so a full inbox
     * is impossible rather than handled.
     */
    public static NtsInbox withCapacity(int capacity) {
        if (capacity < 1) { throw new NtsRefusal("an inbox capacity of " + capacity); }
        return new NtsInbox(capacity);
    }

    public static int capacity(NtsInbox it) { return it.capacity; }

    /** Credits not currently held by outstanding work. */
    public static int available(NtsInbox it) { return it.credits.get(); }

    /**
     * Take a credit before launching, or `null` if the ceiling is reached.
     *
     * <p>A null answer is the caller's cue to reject, delay, or apply platform
     * backpressure **before the OS work exists** — which is the only place
     * backpressure can be applied without either blocking a lane or dropping a
     * completion that liveness has already counted.
     */
    public static Slot reserve(NtsInbox it) {
        for (;;) {
            int have = it.credits.get();
            if (have == 0) { return null; }
            if (it.credits.compareAndSet(have, have - 1)) {
                Slot slot = new Slot();
                slot.owner = it;
                return slot;
            }
        }
    }

    /**
     * Publish a completion into a reserved slot. Wait-free, allocation-free,
     * callable from any thread, and cannot fail.
     */
    public static void post(Slot slot, NtsResumable work) {
        NtsInbox held = slot.owner;
        if (held == null) { throw new NtsRefusal("posting to a slot that was already returned"); }
        // A completion arriving after close is dropped by the thread that
        // produced it and its credit goes straight back. Linking it into a
        // queue nobody will drain loses the credit, and an environment that
        // has lost a credit never reaches zero liveness and never finishes
        // closing.
        //
        // A window remains: a producer can read this as false and link a moment
        // later. `reclaim` closes it by draining until every credit is back
        // rather than draining once.
        if (held.closed) {
            slot.owner = null;
            slot.work = null;
            held.credits.incrementAndGet();
            wake(held);
            return;
        }
        slot.work = work;
        slot.next = null;
        // `getAndSet` then a volatile write to the previous node's link. The
        // consumer may briefly see a gap between the two, which `drain`
        // handles by stopping rather than by spinning.
        NtsInbox inbox = slot.owner;
        Slot previous = inbox.tail.getAndSet(slot);
        previous.next = slot;
        // Wake a parked owner. `unpark` on a running thread leaves a permit
        // and costs almost nothing; on a parked one it is the whole point.
        // A `parked` flag would skip the call in the common case and is a
        // classic race to get wrong, so it is not here and is not measured.
        wake(inbox);
    }

    private static void wake(NtsInbox inbox) {
        Thread lane = inbox.owner;
        if (lane != null) { LockSupport.unpark(lane); }
    }

    /** Claim or release the wake target, from that lane itself. */
    public static void ownedBy(NtsInbox it, Thread lane) {
        Thread caller = Thread.currentThread();
        synchronized (it) {
            if (it.owner != null && it.owner != caller) { throw wrongConsumer(it.owner, caller); }
            if (lane != null && lane != caller) { throw wrongConsumer(lane, caller); }
            it.owner = lane;
        }
    }

    private static IllegalStateException wrongConsumer(Thread owner, Thread caller) {
        return new IllegalStateException("inbox consumer belongs to thread " + owner.getName()
            + " (" + owner.getId() + "), called from " + caller.getName() + " (" + caller.getId() + ")");
    }

    /** One head consumer; the usual path is an intrinsic and one comparison. */
    static void requireConsumer(NtsInbox it) {
        Thread caller = Thread.currentThread();
        if (it.owner == caller) { return; }
        synchronized (it) {
            if (it.owner != null && it.owner != caller) { throw wrongConsumer(it.owner, caller); }
            it.owner = caller;
        }
    }

    /**
     * Claim this inbox for a lane, or report that another already holds it.
     *
     * <p>`post` wakes `owner`, so a second lane taking it silently would leave
     * the first parked in `drain` with work it will never be told about. The
     * default environment uses the boolean result to refuse a second lane;
     * consumer entry and scoped ownership throw a named invariant failure.
     *
     * <p>Synchronized rather than a compare-and-set on the volatile field,
     * because the check and the write must be one step and this runs once per
     * lane. The read path in `post` is unchanged and still touches nothing but
     * the volatile.
     */
    public static boolean claim(NtsInbox it, Thread lane) {
        synchronized (it) {
            if (it.owner != null && it.owner != lane) {
                return false;
            }
            it.owner = lane;
            return true;
        }
    }

    /**
     * Return a credit without posting: cancellation, or a drop during close.
     *
     * <p>Exactly once, whichever way the work ended, is what makes zero
     * liveness mean something. A slot that has been posted is returned by the
     * consumer instead, in {@link #drain}.
     */
    public static void abandon(Slot slot) {
        NtsInbox owner = slot.owner;
        if (owner == null) { throw new NtsRefusal("returning a slot twice"); }
        slot.owner = null;
        slot.work = null;
        owner.credits.incrementAndGet();
        wake(owner);
    }

    /**
     * Run everything published so far on the calling (owner) thread.
     *
     * <p>Returns how many ran. Stops at the first gap rather than spinning: a
     * producer between its `getAndSet` and its link write has a completion that
     * is not yet visible, and waiting for it on the owner lane would be a lane
     * blocking on an I/O thread — the deadlock the contract exists to avoid.
     * It will be seen on the next drain.
     */
    public static int drain(NtsInbox it) {
        requireConsumer(it);
        int ran = 0;
        for (;;) {
            Slot next = it.head.next;
            if (next == null) { return ran; }
            // The stub advances: the node just consumed becomes the new stub,
            // so no node is ever both live and reachable from `head`.
            it.head = next;
            NtsResumable work = next.work;
            next.work = null;
            next.owner = null;
            it.credits.incrementAndGet();
            ran++;
            if (work != null) { work.resume(); }
        }
    }

    /**
     * Stop accepting completions and take back every credit, including those
     * held by work still running on an I/O thread.
     *
     * <p>Draining once is not enough, and the reason is a race with no lock to
     * take: a producer can read the closed flag as false and link its slot a
     * moment after the drain walked past it. So this alternates *discard,
     * check, park* until the credits are all back, which terminates because every
     * in-flight post either sees the flag and returns its credit or links and
     * is drained by the next pass.
     *
     * <p>Settlement, rather than a wall deadline, decides completion: a delayed
     * producer is still live work. The waiter is installed before checking the
     * credits, and unpark leaves a permit even before park, so a return between
     * the check and park cannot be lost. Interrupts are restored after settling.
     * A caller wanting a bounded diagnostic can use {@link #awaitSettlement};
     * that observation never changes close's result.
     */
    public static void reclaim(NtsInbox it) {
        reclaim(it, null);
    }

    /** Package-local checkpoint lets the driver force check-before-park. */
    static void reclaim(NtsInbox it, Runnable beforePark) {
        requireConsumer(it);
        // The consumer is also the park waiter. No other thread may drain or
        // discard while it closes, and producers read this after credit return.
        it.owner = Thread.currentThread();
        it.closed = true;
        boolean interrupted = false;
        try {
            for (;;) {
                discard(it);
                if (it.credits.get() == it.capacity) { return; }
                if (beforePark != null) { beforePark.run(); }
                LockSupport.park(it);
                interrupted |= Thread.interrupted();
            }
        } finally {
            if (interrupted) { Thread.currentThread().interrupt(); }
        }
    }

    /**
     * Explicit bounded observation of one reserved slot. Null means it was
     * returned; otherwise the diagnostic names the slot still holding work.
     * This does not cancel work, reclaim credits, or decide whether close may
     * finish. Polling here is for callers asking for a report; close waits on
     * the settlement event itself.
     */
    public static String awaitSettlement(Slot slot, double timeoutMillis) {
        long deadline = System.nanoTime() + (long) (timeoutMillis * 1_000_000.0);
        boolean interrupted = false;
        try {
            while (slot.owner != null) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) { return slot + " has not settled"; }
                LockSupport.parkNanos(slot, Math.min(remaining, 1_000_000L));
                interrupted |= Thread.interrupted();
            }
            return null;
        } finally {
            if (interrupted) { Thread.currentThread().interrupt(); }
        }
    }

    /** Whether {@link #reclaim} has run. */
    public static boolean isClosed(NtsInbox it) { return it.closed; }

    /**
     * Discard everything published without running it, returning every credit.
     *
     * <p>Close drops what it cannot deliver, and a dropped completion still
     * returns its obligations — otherwise a closing environment never reaches
     * zero liveness and never finishes closing.
     */
    public static int discard(NtsInbox it) {
        requireConsumer(it);
        int dropped = 0;
        for (;;) {
            Slot next = it.head.next;
            if (next == null) { return dropped; }
            it.head = next;
            next.work = null;
            next.owner = null;
            it.credits.incrementAndGet();
            dropped++;
        }
    }
}
