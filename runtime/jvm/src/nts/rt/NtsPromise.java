package nts.rt;

/** Single-threaded promise state with FIFO, asynchronous resumptions. */
public final class NtsPromise {
    private static final int PENDING = 0, FULFILLED = 1, REJECTED = 2;
    private int state;
    private NtsValue settled = NtsValue.UNDEFINED_VALUE;
    // Zero or one waiter needs no backing array; the common await case is inline.
    private NtsResumable first;
    private NtsResumable[] more;
    private int waitingCount;

    private NtsPromise() {}
    public static NtsPromise newPromise() { return new NtsPromise(); }

    private static void settle(NtsPromise promise, int state, NtsValue value) {
        if (promise.state != PENDING) { return; }
        promise.state = state;
        promise.settled = value;
        int n = promise.waitingCount;
        NtsResumable first = promise.first;
        NtsResumable[] more = promise.more;
        promise.first = null;
        promise.more = null;
        promise.waitingCount = 0;
        if (n != 0) {
            NtsLoop.microtask(first);
            for (int i = 0; i < n - 1; i++) {
                NtsLoop.microtask(more[i]);
                more[i] = null;
            }
        }
    }

    public static void fulfillVoid(NtsPromise promise) {
        settle(promise, FULFILLED, NtsValue.UNDEFINED_VALUE);
    }
    public static void fulfillNumber(NtsPromise promise, double value) {
        if (promise.state == PENDING) { settle(promise, FULFILLED, NtsValue.ofNumber(value)); }
    }
    public static void fulfillReference(NtsPromise promise, Object value) {
        if (promise.state == PENDING) { settle(promise, FULFILLED, NtsValue.ofObject(value)); }
    }
    public static void fulfillTagged(NtsPromise promise, Object value, int tag) {
        if (promise.state == PENDING) { settle(promise, FULFILLED, NtsValue.ofTagged(tag, value)); }
    }
    public static void fulfillValue(NtsPromise promise, NtsValue value) {
        settle(promise, FULFILLED, value);
    }
    public static void reject(NtsPromise promise, Object reason) {
        if (promise.state == PENDING) { settle(promise, REJECTED, NtsValue.ofObject(reason)); }
    }
    public static void rejectWith(NtsPromise result, NtsPromise source) {
        settle(result, REJECTED, source.settled);
    }
    public static boolean isRejected(NtsPromise promise) { return promise.state == REJECTED; }
    public static boolean isSettled(NtsPromise promise) { return promise.state != PENDING; }
    public static double number(NtsPromise promise) { return promise.settled.num; }
    public static Object reference(NtsPromise promise) { return promise.settled.ref; }
    public static NtsValue value(NtsPromise promise) { return promise.settled; }

    public static void subscribe(NtsPromise promise, NtsResumable frame) {
        if (frame == null) { throw new NullPointerException("resumable frame"); }
        if (promise.state != PENDING) {
            NtsLoop.microtask(frame);
            return;
        }
        int n = promise.waitingCount;
        if (n == 0) {
            promise.first = frame;
        } else {
            if (promise.more == null) {
                promise.more = new NtsResumable[4];
            } else if (n - 1 == promise.more.length) {
                promise.more = java.util.Arrays.copyOf(promise.more,
                    NtsArrays.growCapacity(promise.more.length, n));
            }
            promise.more[n - 1] = frame;
        }
        promise.waitingCount = n + 1;
    }

    private abstract static class All {
        int remaining;
        All(int remaining) { this.remaining = remaining; }
        abstract void store(int index, NtsValue value);
        /**
         * The array this group fills, which is what {@code Promise.all}
         * resolves *with*.
         *
         * <p>Both settle paths used to answer {@code UNDEFINED_VALUE}, so
         * {@code reference()} on the result was null. A caller holding the
         * array it passed in never noticed; `allOfNone` awaits
         * `Promise.all([])` and reads the resolved value, and got a
         * {@code NullPointerException} on `arraylength`.
         */
        abstract Object values();
    }
    private static final class AllNumbers extends All {
        private final double[] values;
        AllNumbers(int count, double[] values) { super(count); this.values = values; }
        @Override void store(int index, NtsValue value) { values[index] = value.num; }
        @Override Object values() { return values; }
    }
    private static final class AllReferences extends All {
        private final Object[] values;
        AllReferences(int count, Object[] values) { super(count); this.values = values; }
        @Override void store(int index, NtsValue value) { values[index] = value.ref; }
        @Override Object values() { return values; }
    }
    private static final class Waiting implements NtsResumable {
        private final NtsPromise element;
        private final NtsPromise result;
        private final All group;
        private final int index;
        Waiting(NtsPromise element, NtsPromise result, All group, int index) {
            this.element = element;
            this.result = result;
            this.group = group;
            this.index = index;
        }
        @Override public void resume() {
            if (group == null) {
                settle(result, element.state == REJECTED ? REJECTED : FULFILLED, element.settled);
            } else if (element.state == REJECTED) {
                settle(result, REJECTED, element.settled);
            } else {
                // Input position, not settlement order. Duplicated inputs get distinct indices.
                group.store(index, element.settled);
                if (--group.remaining == 0) {
                    settle(result, FULFILLED, NtsValue.ofObject(group.values()));
                }
            }
        }
    }
    private static NtsPromise combine(NtsPromise[] promises, All group) {
        NtsPromise result = new NtsPromise();
        if (promises.length == 0) {
            // An empty `Promise.all` resolves immediately, and with the array
            // rather than with nothing: `(await Promise.all([])).length` is 0,
            // not a read of `undefined`.
            if (group != null) { settle(result, FULFILLED, NtsValue.ofObject(group.values())); }
            return result;
        }
        for (int i = 0; i < promises.length; i++) {
            subscribe(promises[i], new Waiting(promises[i], result, group, i));
        }
        return result;
    }
    public static NtsPromise all(NtsPromise[] promises, double[] values) {
        return combine(promises, new AllNumbers(promises.length, values));
    }
    public static NtsPromise all(NtsPromise[] promises, Object[] values) {
        return combine(promises, new AllReferences(promises.length, values));
    }
    public static NtsPromise race(NtsPromise[] promises) { return combine(promises, null); }
}
