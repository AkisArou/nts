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
}
