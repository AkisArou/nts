package org.nts.web;

/**
 * Which default-network events mean the open sockets are dead.
 *
 * <h2>Why this is a class and not four lines inside the Android adapter</h2>
 *
 * <p>{@link NetworkPrimitives#networkChanged()} closes every connection and
 * says why: a socket on a replaced network reports nothing, so a read blocks
 * for as long as the kernel will allow -- tens of seconds on a handover -- and
 * the failure a program eventually sees is a timeout long after the cause,
 * describing the wrong thing.
 *
 * <p>Nothing called it. There was no `ConnectivityManager` and no
 * `NetworkCallback` anywhere in this library, so on a real handover the sweep
 * that method exists to perform never happened. The method was reachable only
 * from a test and from the shared layer calling it by hand, which is not where
 * a handover is noticed.
 *
 * <p>The decision is here, with no `android.*` import, for the reason the whole
 * SDK dependency is one file: this way it runs on a desktop JVM and is driven
 * by a test with no device. What is left in `AndroidNetworking` is the
 * registration, which is the part only a device can exercise.
 *
 * <h2>The rules, and why each is not the obvious one</h2>
 *
 * <p>**The first network is not a change.** A provider that swept on its first
 * `onAvailable` would close every connection made between construction and the
 * callback's first delivery, which is a real window and always the wrong thing
 * to do -- those sockets are on the network that just became default.
 *
 * <p>**The same network arriving again is not a change.** `onAvailable` fires
 * for capability and link-property changes too; sweeping on those would close
 * live connections every time the signal strength crossed a threshold.
 *
 * <p>**Losing a network that is not the current one is not a change.** A
 * handover delivers the new network's `onAvailable` before the old one's
 * `onLost`, so by the time the loss arrives the sweep has already happened and
 * the sockets it would close belong to the network that replaced it.
 *
 * <p>Not thread-safe by itself: `NetworkCallback` delivers on one handler
 * thread, which is the only caller.
 */
final class DefaultNetworkWatch {
    /** The network this lane's sockets are on, or null before the first arrives. */
    private Object current;

    /**
     * A network became the default. Answers whether the open sockets are now on
     * a network that no longer carries them.
     */
    boolean available(Object network) {
        if (network == null) {
            return false;
        }
        Object previous = current;
        current = network;
        return previous != null && !previous.equals(network);
    }

    /** A network went away. Answers whether it was the one carrying the sockets. */
    boolean lost(Object network) {
        if (network == null || current == null || !current.equals(network)) {
            return false;
        }
        current = null;
        return true;
    }

    /** For a test to state the invariant rather than infer it from behaviour. */
    Object carrying() {
        return current;
    }
}
