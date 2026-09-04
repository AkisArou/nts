package nts.rt;

/**
 * A promise: a settled-or-not value and the frames waiting on it.
 *
 * <p>The reactions are `NtsResumable` frames rather than callbacks, because
 * that is what `Suspend` produces -- a suspended function's locals, on the
 * heap, with a named function to resume it. A settled promise enqueues its
 * waiters as **microtasks** rather than running them: `await` after a promise
 * has already resolved still yields, which is observable and is the difference
 * between this and a synchronous callback.
 *
 * <p>The value is an `NtsValue` whatever the promise settles with, which is
 * what `ManagedType::Promise`'s payload type says it is for: the payload is in
 * the type for the *compiler*, to choose which `fulfill` to emit and how to
 * read the value back, and there is one runtime layout regardless. So this is
 * not a monomorphization.
 */
public final class NtsPromise {
    private static final int PENDING = 0;
    private static final int FULFILLED = 1;
    private static final int REJECTED = 2;

    private int state = PENDING;
    private NtsValue settled = NtsValue.UNDEFINED_VALUE;
    private NtsResumable[] waiting = new NtsResumable[2];
    private int waitingCount;

    private NtsPromise() {}

    public static NtsPromise newPromise() {
        return new NtsPromise();
    }

    // ----- settling -------------------------------------------------------

    private static void settle(NtsPromise promise, int state, NtsValue value) {
        if (promise.state != PENDING) {
            // Already settled. The language says the first settlement wins and
            // the rest are ignored -- not an error, which is why a second
            // `resolve` in a `new Promise` executor is silent.
            return;
        }
        promise.state = state;
        promise.settled = value;
        for (int at = 0; at < promise.waitingCount; at++) {
            NtsLoop.microtask(promise.waiting[at]);
            promise.waiting[at] = null;
        }
        promise.waitingCount = 0;
    }

    public static void fulfillVoid(NtsPromise promise) {
        settle(promise, FULFILLED, NtsValue.UNDEFINED_VALUE);
    }

    public static void fulfillNumber(NtsPromise promise, double value) {
        settle(promise, FULFILLED, NtsValue.ofNumber(value));
    }

    public static void fulfillReference(NtsPromise promise, Object value) {
        settle(promise, FULFILLED, NtsValue.ofObject(value));
    }

    /**
     * Fulfil with a reference whose tag the *compiler* knows.
     *
     * <p>`fulfillReference` derives the tag by looking at the object; this one
     * is told, because a string and an object are both references here and only
     * the type says which.
     */
    public static void fulfillTagged(NtsPromise promise, Object value, int tag) {
        settle(promise, FULFILLED, NtsValue.ofTagged(tag, value));
    }

    public static void fulfillValue(NtsPromise promise, NtsValue value) {
        settle(promise, FULFILLED, value);
    }

    public static void reject(NtsPromise promise, Object reason) {
        settle(promise, REJECTED, NtsValue.ofObject(reason));
    }

    /** Reject `result` with whatever `source` was rejected with. */
    public static void rejectWith(NtsPromise result, NtsPromise source) {
        settle(result, REJECTED, source.settled);
    }

    // ----- reading --------------------------------------------------------

    public static boolean isRejected(NtsPromise promise) {
        return promise.state == REJECTED;
    }

    public static boolean isSettled(NtsPromise promise) {
        return promise.state != PENDING;
    }

    public static double number(NtsPromise promise) {
        return promise.settled.num;
    }

    public static Object reference(NtsPromise promise) {
        return promise.settled.ref;
    }

    public static NtsValue value(NtsPromise promise) {
        return promise.settled;
    }

    // ----- waiting --------------------------------------------------------

    /**
     * Resume `frame` when this promise settles -- or on the next microtask if
     * it already has.
     *
     * <p>The already-settled case is the one that has to be a microtask rather
     * than a direct call. `await` on a resolved promise still yields, and a
     * program that printed in the other order would be wrong in a way no type
     * catches.
     */
    public static void subscribe(NtsPromise promise, NtsResumable frame) {
        if (promise.state != PENDING) {
            NtsLoop.microtask(frame);
            return;
        }
        if (promise.waitingCount == promise.waiting.length) {
            promise.waiting = java.util.Arrays.copyOf(promise.waiting, promise.waitingCount * 2);
        }
        promise.waiting[promise.waitingCount++] = frame;
    }

    // ----- combinators (docs/async.md 5b) ---------------------------------

    /**
     * `Promise.all`: fulfils with the values in **input order** once every
     * element has fulfilled, and rejects with the first rejection.
     *
     * <p>Subscribes to every element *before* returning, so an element that
     * settles during the call is not missed -- which is why the loop below
     * cannot exit early on a rejection.
     *
     * <p>`values` is allocated by the compiler because only it knows whether a
     * payload is a double or a reference, and it is written in place rather
     * than returned: the caller already has the array and its element type.
     *
     * <p>A named class rather than a lambda. `LambdaMetafactory` spins a hidden
     * class through `invokedynamic`, which this runtime forbids outright --
     * `runtime_jar.rs` asserts zero of them, because `invokedynamic` needs
     * Android API 26 and that assertion is what keeps the Android path open for
     * free.
     */
    private static final class Waiting implements NtsResumable {
        private final NtsPromise element;
        private final NtsPromise result;
        private final All group;

        Waiting(NtsPromise element, NtsPromise result, All group) {
            this.element = element;
            this.result = result;
            this.group = group;
        }

        @Override
        public void resume() {
            if (group == null) {
                // `race`: the first settlement of either kind wins, and every
                // later one finds the result already settled and is ignored.
                if (isRejected(element)) {
                    settle(result, REJECTED, element.settled);
                } else {
                    settle(result, FULFILLED, element.settled);
                }
                return;
            }
            if (isRejected(element)) {
                settle(result, REJECTED, element.settled);
                return;
            }
            group.store(element.settled);
            if (--group.remaining == 0) {
                settle(result, FULFILLED, NtsValue.UNDEFINED_VALUE);
            }
        }
    }

    /** Where one element's value goes, and how many are still outstanding. */
    private abstract static class All {
        int remaining;
        int at;

        abstract void store(NtsValue value);
    }

    private static NtsPromise combine(NtsPromise[] promises, All group) {
        NtsPromise result = new NtsPromise();
        if (promises.length == 0) {
            // `all` of nothing is already fulfilled; `race` of nothing never
            // settles, which is what the language says and what this does.
            if (group != null) {
                settle(result, FULFILLED, NtsValue.UNDEFINED_VALUE);
            }
            return result;
        }
        for (NtsPromise element : promises) {
            subscribe(element, new Waiting(element, result, group));
        }
        return result;
    }

    public static NtsPromise all(NtsPromise[] promises, final double[] values) {
        All group = new All() {
            @Override
            void store(NtsValue value) {
                values[at++] = value.num;
            }
        };
        group.remaining = promises.length;
        return combine(promises, group);
    }

    public static NtsPromise all(NtsPromise[] promises, final Object[] values) {
        All group = new All() {
            @Override
            void store(NtsValue value) {
                values[at++] = value.ref;
            }
        };
        group.remaining = promises.length;
        return combine(promises, group);
    }

    public static NtsPromise race(NtsPromise[] promises) {
        return combine(promises, null);
    }
}
