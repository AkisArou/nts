package nts.rt;

/**
 * A generated class whose hierarchy root carries optional-property presence
 * bits, exposing them where {@code instanceof} can reach them.
 *
 * <p>{@code runtime/c} keeps these bits in the object header's spare flags, so
 * {@code nts_presence_has_value} there is a tag test and a read at a fixed
 * offset -- it needs no class, because every object has the same header.
 * <b>There is no header here.</b> RFC 13 puts these objects in the platform
 * collector's heap, so the bits are an {@code int} field on the hierarchy root
 * and the field's owner differs per hierarchy.
 *
 * <p>That is fine for the other four helpers, whose receiver has a declared
 * type the backend can name. It is not fine for this one: {@code "k" in v}
 * where {@code v} is typed {@code object} asks about a value whose class is not
 * known until run time, and the helper's signature carries no class to name.
 *
 * <p>So the question goes where {@code instanceof} can answer it, which is the
 * same answer {@link NtsStringable} and {@link NtsTuple} give to their own
 * versions of "a fact about the class, asked of a value". A root that holds
 * presence bits implements this; nothing else does, so a value that is not one
 * answers {@code false} rather than faulting -- which is what lets the lowering
 * emit a plain {@code and} beside the class test instead of blocks for a short
 * circuit.
 */
public interface NtsPresence {
    /** This object's presence word, one bit per optional property, base-first. */
    int ntsPresence();
}
