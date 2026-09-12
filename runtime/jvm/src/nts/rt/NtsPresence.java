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
 * <p>So the question goes where {@code instanceof} can answer it. A root that
 * holds presence bits implements this; nothing else does, so a value that is
 * not one answers {@code false} rather than faulting -- which is what lets the
 * lowering emit a plain {@code and} beside the class test instead of blocks for
 * a short circuit.
 *
 * <h2>This is the third of one shape, and at three it is the mechanism</h2>
 *
 * {@link NtsStringable} asks whether a class declares its own {@code toString};
 * {@link NtsTuple} asks whether a layout the language calls an Array is laid
 * out as a struct; this asks whether a root carries presence bits. All three
 * are <b>a fact about the class, asked of a value</b>, and all three are facts
 * {@code runtime/c} reads off a descriptor the object points at.
 *
 * <p>This lane has no descriptor -- an object is a plain JVM instance -- so the
 * fact has nowhere to live except the class hierarchy, and {@code instanceof}
 * is the only instrument that reads it. A fourth of these should be an empty
 * interface too rather than a field, a tag, or a method every generated class
 * has to answer.
 *
 * <p><b>And the C signature is not the general one.</b> There,
 * {@code nts_presence_has_value} has two cases -- not a reference, and a
 * reference -- because every object has the same header at the same offset, so
 * asking an arbitrary object for its flags word is always defined and answers
 * zero. Here there are <b>three</b>: null, not a reference, and a reference
 * whose class carries no presence bits. C collapses the third by construction
 * rather than by handling it. A backend that arrives later without a header
 * will have this lane's problem and not that one.
 */
public interface NtsPresence {
    /** This object's presence word, one bit per optional property, base-first. */
    int ntsPresence();
}
