package org.nts.web;

/**
 * Which default-network events mean the open sockets are dead.
 *
 * <p>No device and no `android.*`: the decision is
 * {@link DefaultNetworkWatch}, which is a class precisely so that this can run
 * on a desktop JVM. What a device is still needed for is the registration -- 
 * that `ConnectivityManager` delivers these events at all, and in this order.
 *
 * <p>Every case here is one this got wrong in an obvious implementation. The
 * first network is not a change; the same network arriving again is not a
 * change; and losing a network that is not the current one is not a change.
 * Sweeping on any of them closes live connections.
 */
public final class DefaultNetworkWatchTest {
    static int tests;
    static int failures;

    static void check(boolean ok, String what) {
        tests++;
        if (!ok) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    public static void main(String[] args) {
        // The first network to arrive carries the sockets made before it did.
        // A sweep here closes every connection opened between construction and
        // the callback's first delivery, which is a real window.
        DefaultNetworkWatch first = new DefaultNetworkWatch();
        check(!first.available("wifi"), "the first network was treated as a change");
        check("wifi".equals(first.carrying()), "the first network was not recorded");

        // `onAvailable` fires for capability and link-property changes too.
        // Sweeping on those closes live connections whenever signal strength
        // crosses a threshold.
        check(!first.available("wifi"), "the same network arriving again was a change");

        // A handover: the new network arrives and the sockets on the old one
        // are gone, whatever the kernel is still willing to pretend.
        check(first.available("cell"), "a handover was not a change");
        check("cell".equals(first.carrying()), "the new network was not recorded");

        // A handover delivers the new network's `onAvailable` before the old
        // one's `onLost`, so the loss that follows must not sweep again -- the
        // sockets it would close are on the network that replaced it.
        check(!first.lost("wifi"), "losing the replaced network swept a second time");
        check("cell".equals(first.carrying()), "a stale loss cleared the current network");

        // Losing the network that is carrying them is a change.
        check(first.lost("cell"), "losing the current network was not a change");
        check(first.carrying() == null, "the lost network was still recorded");

        // And a second loss of the same network is not.
        check(!first.lost("cell"), "losing the same network twice swept twice");

        // Nothing arrives from a null network, but a callback that delivered
        // one must not become a sweep of every socket.
        DefaultNetworkWatch guarded = new DefaultNetworkWatch();
        check(!guarded.available(null), "a null network was a change");
        check(!guarded.lost(null), "losing a null network was a change");

        // After a loss, the next network to arrive is a first network again.
        DefaultNetworkWatch again = new DefaultNetworkWatch();
        again.available("wifi");
        again.lost("wifi");
        check(!again.available("cell"), "the network after a total loss was a change");

        System.out.println("PASS: " + tests + " default-network cases, " + failures + " failures");
        if (failures != 0) {
            System.exit(1);
        }
    }
}
