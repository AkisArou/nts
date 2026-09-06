package nts.rt;

/**
 * A generated closure of shape `(a: string, b: string) => void`.
 *
 * <p>Two strings rather than one error object because an error object is a
 * representation decision that belongs with the common types, not with this
 * lane: a failing connect reports a code and a message, both of which are
 * strings on every provider, and a JVM-only error class would be exactly the
 * kind of local semantics the transport is supposed to avoid.
 */
public interface NtsTextPairCallback {
    void call(String first, String second);
}
