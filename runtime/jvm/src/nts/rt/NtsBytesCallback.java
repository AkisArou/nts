package nts.rt;

/**
 * A generated closure of shape `(bytes: Uint8Array, offset: number, length: number) => void`.
 *
 * <p>The byte view arrives as the three things a view is, rather than as a
 * wrapper this lane invented: until the common typed-memory model exists there
 * is nothing to wrap, and a temporary wrapper would have to be unwrapped again
 * by every caller once there is.
 */
public interface NtsBytesCallback {
    void call(byte[] bytes, double offset, double length);
}
