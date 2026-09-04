package nts.rt;

/**
 * Something the event loop can run: a suspended function's frame.
 *
 * <p>`Suspend { promise, frame, resume }` names a *function*, not a function
 * pointer -- the IR has no type for an address, and spelling one as an integer
 * would be a lie the backend has to undo. So the frame's generated class
 * implements this, with `resume()` forwarding to the static body, exactly the
 * way a dispatch slot's forwarder does.
 *
 * <p>An interface rather than an abstract class because a frame already extends
 * whatever its layout says, and because this is the one nominal relationship
 * the JVM lane needs that it can *create* rather than recover: the compiler
 * emits the frame class and knows from the `Suspend` which function resumes it.
 * Nothing upstream has to carry it.
 *
 * <p>Not a `Runnable`: the name would suggest it can be handed to an
 * `Executor`, and it cannot -- these run on one thread, in an order the
 * language specifies.
 */
public interface NtsResumable {
    void resume();
}
