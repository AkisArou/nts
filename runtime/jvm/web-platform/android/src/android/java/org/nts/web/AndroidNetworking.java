package org.nts.web;

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
}
