package nts.rt;

import java.util.ArrayDeque;
import java.util.Arrays;

/** Thread-confined tick/microtask queues and a cancellable virtual-time timer heap. */
public final class NtsLoop {
    private NtsLoop() {}
    // ArrayDeque already stores references without allocating a node per enqueue.
    private static final ArrayDeque<NtsResumable> MICROTASKS = new ArrayDeque<NtsResumable>();
    private static final ArrayDeque<NtsResumable> TICKS = new ArrayDeque<NtsResumable>();
    private static int depth;

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
    private static Timer[] heap = EMPTY_TIMERS;
    // Open addressing by numeric timer id: no Double keys or HashMap nodes.
    private static Timer[] byId = EMPTY_TIMERS;
    private static int size;
    private static int idThreshold;
    private static double now;
    private static long sequence;
    private static double nextId = 1.0;

    static double delay(double milliseconds) {
        if (!(milliseconds > 0.0)) { return 0.0; }
        return milliseconds > 9007199254740991.0 ? 9007199254740991.0 : Math.floor(milliseconds);
    }
    public static double postDelayed(NtsCallback callback, double milliseconds, boolean repeating) {
        if (nextId > 9007199254740991.0) {
            throw new NtsRefusal("timer id space exhausted");
        }
        if (size == heap.length) {
            heap = Arrays.copyOf(heap, NtsArrays.growCapacity(heap.length, size + 1));
        }
        if (size >= idThreshold) { growIdIndex(); }
        double wait = delay(milliseconds);
        double id = nextId++;
        Timer timer = new Timer(now + wait, sequence++, id, callback, repeating, wait);
        int bucket = idHash(id) & (byId.length - 1);
        while (byId[bucket] != null) { bucket = (bucket + 1) & (byId.length - 1); }
        byId[bucket] = timer;
        siftUp(size++, timer);
        return id;
    }
    public static void cancelDelayed(double id) {
        int bucket = findId(id);
        if (bucket < 0) { return; }
        Timer timer = byId[bucket];
        removeId(bucket);
        removeHeap(timer.heapIndex);
    }
    private static int idHash(double id) {
        long x = (long) id;
        int h = (int) (x ^ (x >>> 32));
        h ^= h >>> 16;
        h *= 0x7feb352d;
        h ^= h >>> 15;
        return h;
    }
    private static int findId(double id) {
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
    private static void growIdIndex() {
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
    private static void removeId(int hole) {
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
    private static void siftUp(int at, Timer timer) {
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
    private static void siftDown(int at, Timer timer) {
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
    private static void removeHeap(int at) {
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
    private static boolean fireEarliest() {
        if (size == 0) { return false; }
        Timer timer = heap[0];
        if (timer.due > now) { now = timer.due; }
        if (timer.repeating) {
            // Re-arm before the callback, so clearInterval inside it can cancel
            // the next occurrence. Reuse the same Timer rather than allocate one.
            timer.due = now + timer.interval;
            timer.seq = sequence++;
            siftDown(0, timer);
        } else {
            removeId(findId(timer.id));
            removeHeap(0);
        }
        timer.callback.call();
        return true;
    }
    public static void enter() { depth++; }
    public static void leave() {
        if (--depth == 0) { checkpoint(); }
    }
    public static void microtask(NtsResumable task) { MICROTASKS.addLast(task); }
    public static void tick(NtsResumable task) { TICKS.addLast(task); }
    private static void checkpoint() {
        do {
            NtsResumable task;
            while ((task = TICKS.pollFirst()) != null) { task.resume(); }
            while ((task = MICROTASKS.pollFirst()) != null) { task.resume(); }
        } while (!TICKS.isEmpty());
    }
    public static boolean step() {
        NtsResumable next = TICKS.pollFirst();
        if (next == null) { next = MICROTASKS.pollFirst(); }
        if (next == null) { return fireEarliest(); }
        next.resume();
        return true;
    }
    public static void drain() {
        depth = 1;
        leave();
        while (fireEarliest()) {
            depth = 1;
            leave();
        }
    }
}
