package org.nts.web;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.security.NetworkSecurityPolicy;
import java.util.concurrent.Executor;

/** Android-only factory; compile in the Android app/library source set (minSdk 26). */
public final class AndroidNetworking {
    private AndroidNetworking() {}

    public static NetworkPrimitives create(Executor ntsRuntimeLane, NetworkPrimitives.ErrorReporter errors, int maxConnections) {
        return new NetworkPrimitives(ntsRuntimeLane,
                host -> NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(host),
                errors, maxConnections);
    }

    /**
     * Sweep the open sockets when the default network is replaced or lost.
     *
     * <p>**A provider that does not call this will not notice a handover.**
     * `networkChanged` closes every connection because a socket on a replaced
     * network reports nothing until the kernel gives up -- and nothing in this
     * library called it. It was reachable from a test and from the shared layer
     * asking by hand, which is not where a handover is observed.
     *
     * <p>Returns the registration. Closing it unregisters, and an app that
     * closes its `NetworkPrimitives` should close this too: a callback outlives
     * the primitives it sweeps otherwise, and `ConnectivityManager` holds it
     * process-wide.
     *
     * <p>`registerDefaultNetworkCallback` is API 24 and this library's floor is
     * 26, so there is no version guard. Which events mean what is
     * {@link DefaultNetworkWatch}, deliberately outside this file: it has no
     * `android.*` import and is driven by a test on a desktop JVM, leaving only
     * the registration here -- the part that needs a device.
     */
    public static AutoCloseable watchDefaultNetwork(Context context, NetworkPrimitives primitives) {
        final ConnectivityManager manager =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) {
            // No connectivity service is a device without networking rather
            // than an error to raise: there is nothing to watch and nothing to
            // sweep, and a provider that refused here would refuse to start.
            return () -> { };
        }
        final DefaultNetworkWatch watch = new DefaultNetworkWatch();
        final ConnectivityManager.NetworkCallback callback =
            new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    if (watch.available(network)) {
                        primitives.networkChanged();
                    }
                }

                @Override
                public void onLost(Network network) {
                    if (watch.lost(network)) {
                        primitives.networkChanged();
                    }
                }
            };
        manager.registerDefaultNetworkCallback(callback);
        return () -> manager.unregisterNetworkCallback(callback);
    }
}
