package nts.rt;

/**
 * A Java callback arriving on a thread we do not own, delivered to the lane
 * that does.
 *
 * <p>This is the half of the threading story {@code docs/jvm-interop.md} called
 * unbuilt: {@link NtsInbox} has had {@code reserve}/{@code post}/{@code drain}
 * since the promise work, and a bound Java interface can be implemented by a
 * generated closure, but nothing joined the two. A framework thread calling
 * {@code onBytes} had a closure to invoke and no safe way to invoke it.
 *
 * <h2>Why the callback cannot simply be called</h2>
 *
 * <p>Everything in this runtime except the inbox is confined to one lane --
 * {@code NtsMap}'s own header says so, and the provider doc says the inbox is
 * atomic <em>because one lane mutates everything else</em>. Running a TypeScript
 * closure on a framework thread would mutate that lane's heap from outside it.
 *
 * <p>So the callback is <strong>posted</strong>, and runs when the owning lane
 * next drains. Demonstrated rather than assumed: {@code Demo} in
 * {@code examples/interop/android-shape} prints
 * {@code onBytes ran on: loader (caller: main)} for exactly this shape.
 *
 * <h2>Why every method here returns void, and that is not an omission</h2>
 *
 * <p>Posting means running <em>later</em>, so there is nobody left to return to.
 * A Java interface whose method returns a value -- {@code OnTouch} returning
 * {@code boolean} -- cannot be served this way <strong>at all</strong>, and
 * handing the framework a placeholder would be a wrong answer that runs, which
 * this project treats as worse than a refusal.
 *
 * <p>The other route exists and is better where it applies: {@code NtsEnv} is a
 * {@code ThreadLocal}, so an environment installed on the calling thread makes
 * the callback a <strong>direct call</strong> that can return a value. That is
 * the UI-callback case, and it does not come through here. This class is for
 * the completions -- network, disk -- which the framework declares {@code void}
 * for the same reason we do.
 *
 * <h2>Backpressure</h2>
 *
 * <p>{@link NtsInbox#reserve} answers {@code null} at the ceiling, and its
 * comment is emphatic that this is the only place backpressure can be applied
 * "before the OS work exists". So every method here returns whether the post
 * was accepted, and a {@code false} is the caller's cue to reject or delay --
 * never to drop silently, and never to block the foreign thread.
 */
public final class NtsForeign {
    private NtsForeign() {}

    /**
     * Record the current lane on a closure about to cross to Java.
     *
     * <p>Takes {@code Object} because the emitted code usually holds an erased
     * value here and does not know the class. Values that are not lane-bound --
     * a user object implementing the interface itself, an already-bound Java
     * listener -- pass through untouched, which is why this is an
     * {@code instanceof} rather than a cast.
     *
     * <p>{@link NtsEnv#current} is the claiming form on purpose: this runs in
     * the program's own code, so a thread that is not a lane is a refusal that
     * belongs *here*, where the call site is, rather than later on a framework's
     * thread where it would name nothing a reader could act on.
     */
    public static void bind(Object closure) {
        if (closure instanceof NtsLaneBound) {
            ((NtsLaneBound) closure).bindLane(NtsEnv.current());
        }
    }


    /**
     * Deliver a callback that arrived on a thread we may not own.
     *
     * <p>Returns {@code true} when the work was posted and the caller is done,
     * and {@code false} when the caller is already on the closure's lane and
     * should simply run the body. Those are the only two answers: a thread that
     * is neither is a refusal, thrown here.
     *
     * <p><b>Why this decides rather than the emitted bridge.</b> The questions
     * are all policy -- is this the closure's lane, was the inbox at its
     * ceiling, what should a refusal say -- and a bridge answering them in
     * bytecode puts every one of them where nothing can read or test it. The
     * bridge asks one question and gets one boolean.
     *
     * <p><b>A full inbox throws rather than drops.</b> {@link NtsInbox#reserve}
     * answering {@code null} is the only backpressure signal there is, and the
     * framework method being {@code void} means there is nobody to hand it to.
     * Dropping would lose a completion silently, which is the one outcome the
     * inbox's own contract forbids.
     */
    public static boolean deliverBytes(NtsLaneBound closure, byte[] data) {
        NtsEnv lane = laneOf(closure);
        if (NtsEnv.installed() == lane) {
            return false;
        }
        if (!postBytes(NtsEnv.inbox(lane), (NtsBytesCallback) closure, data, 0,
                       data == null ? 0 : data.length)) {
            throw new NtsRefusal(
                "the lane's inbox is at its ceiling, so this callback cannot be delivered -- "
                    + "raise the capacity with NtsEnv.create, or let the lane drain");
        }
        return true;
    }

    /** {@link #deliverBytes}, for a callback that takes nothing. */
    public static boolean deliver(NtsLaneBound closure) {
        NtsEnv lane = laneOf(closure);
        if (NtsEnv.installed() == lane) {
            return false;
        }
        if (!post(NtsEnv.inbox(lane), (NtsCallback) closure)) {
            throw new NtsRefusal("the lane's inbox is at its ceiling, so this callback "
                + "cannot be delivered -- raise the capacity with NtsEnv.create");
        }
        return true;
    }

    /** {@link #deliverBytes}, for a callback that takes one number. */
    public static boolean deliverNumber(NtsLaneBound closure, double value) {
        NtsEnv lane = laneOf(closure);
        if (NtsEnv.installed() == lane) {
            return false;
        }
        if (!postNumber(NtsEnv.inbox(lane), (NtsNumberCallback) closure, value)) {
            throw new NtsRefusal("the lane's inbox is at its ceiling, so this callback "
                + "cannot be delivered -- raise the capacity with NtsEnv.create");
        }
        return true;
    }

    /** {@link #deliverBytes}, for a callback that takes one string. */
    public static boolean deliverText(NtsLaneBound closure, String value) {
        NtsEnv lane = laneOf(closure);
        if (NtsEnv.installed() == lane) {
            return false;
        }
        if (!postText(NtsEnv.inbox(lane), (NtsTextCallback) closure, value)) {
            throw new NtsRefusal("the lane's inbox is at its ceiling, so this callback "
                + "cannot be delivered -- raise the capacity with NtsEnv.create");
        }
        return true;
    }

    /**
     * The lane a closure crossed on, refusing by name when it never did.
     *
     * <p>Null means the closure reached Java without passing through the
     * crossing that records it -- a route this compiler does not emit, so it is
     * a statement about the compiler rather than about the program, and it says
     * so.
     */
    private static NtsEnv laneOf(NtsLaneBound closure) {
        NtsEnv lane = closure.lane();
        if (lane == null) {
            throw new NtsRefusal(
                "a callback reached Java without a lane recorded, so there is nowhere to "
                    + "deliver it -- this is a compiler bug rather than a program error");
        }
        return lane;
    }

    /**
     * Post a zero-argument callback. Returns false if the inbox is at its
     * ceiling or closed.
     */
    public static boolean post(NtsInbox inbox, final NtsCallback work) {
        NtsInbox.Slot slot = NtsInbox.reserve(inbox);
        if (slot == null) { return false; }
        NtsInbox.post(slot, new NtsResumable() {
            @Override
            public void resume() { work.call(); }
        });
        return true;
    }

    /**
     * Post a callback taking a {@code byte[]}, the shape a read completion has.
     *
     * <p>The array is <strong>captured, not copied</strong>. That is the whole
     * point and it is also a constraint on the caller: the foreign side must
     * not reuse the buffer after posting, because the lane reads it later. A
     * copy here would be a copy on every completion, which is exactly the cost
     * this document exists to avoid -- so the rule is stated instead of paid.
     */
    public static boolean postBytes(NtsInbox inbox, final NtsBytesCallback work,
                                    final byte[] data, final double offset, final double length) {
        NtsInbox.Slot slot = NtsInbox.reserve(inbox);
        if (slot == null) { return false; }
        NtsInbox.post(slot, new NtsResumable() {
            @Override
            public void resume() { work.call(data, offset, length); }
        });
        return true;
    }

    /** Post a callback taking one number. */
    public static boolean postNumber(NtsInbox inbox, final NtsNumberCallback work,
                                     final double value) {
        NtsInbox.Slot slot = NtsInbox.reserve(inbox);
        if (slot == null) { return false; }
        NtsInbox.post(slot, new NtsResumable() {
            @Override
            public void resume() { work.call(value); }
        });
        return true;
    }

    /** Post a callback taking one string. */
    public static boolean postText(NtsInbox inbox, final NtsTextCallback work,
                                   final String value) {
        NtsInbox.Slot slot = NtsInbox.reserve(inbox);
        if (slot == null) { return false; }
        NtsInbox.post(slot, new NtsResumable() {
            @Override
            public void resume() { work.call(value); }
        });
        return true;
    }

    // --- a JavaScript number[] meeting a Java primitive array ----------------
    //
    // **Copied, and narrowed the way JavaScript narrows.** Our `number[]` is a
    // `double[]`; a Java method declaring `int...` wants `[I`, and the two are
    // unrelated types to the verifier however similar the values look. So the
    // elements move, and each one takes the same conversion a scalar would at
    // the same boundary -- `ToInt32`, wrapping, not `d2i`'s saturation.
    //
    // `long` and `float` are plain casts because neither has a JavaScript
    // narrowing to disagree with: a `number` that is not an integer is already
    // outside what a `long` parameter means, and `float` is the one width
    // where the JVM's own conversion is the specified one.

    /** A {@code double[]} as a Java {@code int[]}; see the note above. */
    public static int[] toI(double[] xs) {
        if (xs == null) { return new int[0]; }
        int[] out = new int[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (int) NtsRuntime.toInt32(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code long[]}; see the note above. */
    public static long[] toJ(double[] xs) {
        if (xs == null) { return new long[0]; }
        long[] out = new long[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (long) x; }
        return out;
    }

    /** A {@code double[]} as a Java {@code short[]}; see the note above. */
    public static short[] toS(double[] xs) {
        if (xs == null) { return new short[0]; }
        short[] out = new short[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (short) NtsRuntime.toInt32(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code byte[]}; see the note above. */
    public static byte[] toB(double[] xs) {
        if (xs == null) { return new byte[0]; }
        byte[] out = new byte[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (byte) NtsRuntime.toInt32(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code char[]}; see the note above. */
    public static char[] toC(double[] xs) {
        if (xs == null) { return new char[0]; }
        char[] out = new char[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (char) NtsRuntime.toUint16(x); }
        return out;
    }

    /** A {@code double[]} as a Java {@code float[]}; see the note above. */
    public static float[] toF(double[] xs) {
        if (xs == null) { return new float[0]; }
        float[] out = new float[xs.length];
        for (int i = 0; i < xs.length; i++) { double x = xs[i]; out[i] = (float) x; }
        return out;
    }

    // --- a typed array meeting a Java primitive array ------------------------
    //
    // **The storage itself when the view spans its whole buffer, a copy
    // otherwise.** A `Uint8Array` is a window onto an `NtsBuffer` whose storage
    // *is* a `byte[]`, so the no-copy case is real and is the one a caller
    // reading a whole file hits. A `subarray` is not: it has an offset the
    // array has nowhere to put, so its elements move.
    //
    // Every other width copies unconditionally, because an `NtsBuffer` is
    // `byte[]`-backed and an `int[]` is not a reinterpretation of one.

    /** A `Uint8Array` as a `byte[]`; the storage itself when it spans the buffer. */
    public static byte[] bytes(NtsViewU8 view) {
        if (view == null) { return new byte[0]; }
        byte[] storage = NtsBuffer.storage(NtsAnyView.buffer(view));
        int offset = (int) NtsAnyView.byteOffset(view);
        int length = (int) NtsView.length(view);
        if (offset == 0 && length == storage.length) { return storage; }
        byte[] out = new byte[length];
        System.arraycopy(storage, offset, out, 0, length);
        return out;
    }

    /** A `NtsViewI32` as a Java {@code int[]}; always a copy, see the note above. */
    public static int[] ints(NtsViewI32 view) {
        if (view == null) { return new int[0]; }
        int length = (int) NtsView.length(view);
        int[] out = new int[length];
        for (int i = 0; i < length; i++) { out[i] = (int) NtsViewI32.getAt(view, i); }
        return out;
    }

    /** A `NtsViewI16` as a Java {@code short[]}; always a copy, see the note above. */
    public static short[] shorts(NtsViewI16 view) {
        if (view == null) { return new short[0]; }
        int length = (int) NtsView.length(view);
        short[] out = new short[length];
        for (int i = 0; i < length; i++) { out[i] = (short) NtsViewI16.getAt(view, i); }
        return out;
    }

    /** A `NtsViewU16` as a Java {@code char[]}; always a copy, see the note above. */
    public static char[] chars(NtsViewU16 view) {
        if (view == null) { return new char[0]; }
        int length = (int) NtsView.length(view);
        char[] out = new char[length];
        for (int i = 0; i < length; i++) { out[i] = (char) NtsViewU16.getAt(view, i); }
        return out;
    }

    /** A `NtsViewF32` as a Java {@code float[]}; always a copy, see the note above. */
    public static float[] floats(NtsViewF32 view) {
        if (view == null) { return new float[0]; }
        int length = (int) NtsView.length(view);
        float[] out = new float[length];
        for (int i = 0; i < length; i++) { out[i] = (float) NtsViewF32.getAt(view, i); }
        return out;
    }

    /** A `NtsViewF64` as a Java {@code double[]}; always a copy, see the note above. */
    public static double[] doubles(NtsViewF64 view) {
        if (view == null) { return new double[0]; }
        int length = (int) NtsView.length(view);
        double[] out = new double[length];
        for (int i = 0; i < length; i++) { out[i] =  NtsViewF64.getAt(view, i); }
        return out;
    }

    // --- a growable array meeting a Java array -------------------------------
    //
    // **The wrapper's `items` is longer than its `length`**, so even the
    // same-element case cannot be handed over: the callee would see trailing
    // slots the program does not consider part of the array. That is why
    // `arrays_can_grow` makes every crossing a copy, and why the copy is here
    // rather than at the call site.
    //
    // The reference case takes an **empty array of the wanted type** rather
    // than a `Class`, because `Arrays.copyOf` preserves its argument's runtime
    // type and the backend can build one with `anewarray` -- no class constant,
    // no reflection, and the verifier checks the result is really a `String[]`.

    /** A growable reference array as a Java array of `template`'s own type. */
    public static Object[] objects(NtsArrayL from, Object[] template) {
        int length = from == null ? 0 : (int) NtsArrayL.length(from);
        Object[] out = java.util.Arrays.copyOf(template, length);
        if (from != null) { System.arraycopy(from.items, 0, out, 0, length); }
        return out;
    }

    /**
     * A growable boolean array as a Java {@code boolean[]}.
     *
     * **The only primitive that reaches here**, which is worth saying because
     * the obvious siblings were written first and could never run: `nts bind`
     * maps `[I` to `Int32Array` and every other primitive array to a typed
     * array, and a typed array is a *view* -- `arrays_can_grow` does not touch
     * one. `boolean` has no typed array, so `[Z` is the one primitive that
     * binds as a plain `T[]` and can therefore be behind the growable wrapper.
     */
    public static boolean[] grownZ(NtsArrayZ from) {
        int length = from == null ? 0 : (int) NtsArrayZ.length(from);
        boolean[] out = new boolean[length];
        if (from != null) { System.arraycopy(from.items, 0, out, 0, length); }
        return out;
    }

    // --- a Java reference arriving where a JavaScript value is held ----------

    /**
     * A Java reference as the {@link NtsValue} a `number | null` is held in.
     *
     * **Where a boxed primitive stops being a Java-ism.** `nts bind` renders
     * `java.lang.Integer` as `number`, so `map.get(k)` is `number | null` and
     * the caller writes `?? 0` rather than a null check and an `intValue()`.
     * The declared type erases to `Object` in the class file, so the unboxing
     * has to happen here -- by the value's *runtime* type, because the
     * declaration no longer says which it is.
     *
     * A `Number` becomes a number and a `Boolean` a boolean, which is what the
     * mapping promised. Anything else keeps its identity, so an object a Java
     * method returns comes back as itself rather than being flattened.
     */
    public static NtsValue value(Object from) {
        if (from == null) { return NtsValue.NULL_VALUE; }
        if (from instanceof Number) { return NtsValue.ofNumber(((Number) from).doubleValue()); }
        if (from instanceof Boolean) { return NtsValue.ofBoolean((Boolean) from); }
        if (from instanceof String) { return NtsValue.ofString((String) from); }
        return NtsValue.ofObject(from);
    }
}
