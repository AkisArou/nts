package nts.rt;

/**
 * A generated closure that remembers which lane it belongs to.
 *
 * <p>Implemented by exactly those closure classes that can be handed to a Java
 * interface with a {@code void} member -- the only shape a foreign thread can be
 * served at all, because posting runs later and there is nobody left to return a
 * value to.
 *
 * <p><b>An interface rather than a field the compiler writes directly, and the
 * reason is the erased path.</b> A closure crossing to Java usually arrives as
 * an {@code NtsValue}: the binding renders a callback parameter as a union, so
 * the argument is erased and the emitted code reads {@code .ref} and casts to the
 * jar's interface. At that point the static type is `NtsValue` and the concrete
 * closure class is not known, so there is no field to name. A call through this
 * interface needs no name -- and {@link NtsForeign#bind} makes even the
 * {@code instanceof} the runtime's problem rather than the emitter's.
 */
public interface NtsLaneBound {
    /** Remember the lane; called at the crossing, on that lane. */
    void bindLane(NtsEnv lane);

    /**
     * The lane remembered, or {@code null} if this closure never crossed on one.
     *
     * <p>Here so that {@link NtsForeign} can decide delivery on its own. The
     * alternative is the emitter reading a generated field and branching in
     * bytecode, which puts the policy -- is this our lane, is the inbox full,
     * what does a refusal say -- in the one place it cannot be read or tested.
     */
    NtsEnv lane();
}
