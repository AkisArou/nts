package org.nts.proxyprobe;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.URI;
import java.util.List;

/**
 * Asks the platform what proxy applies, from inside a framework-started process.
 *
 * <p>The same question `NtsWeb.systemProxyFor` asks, deliberately duplicated
 * rather than linked: this is measuring **the platform**, and importing the
 * provider would make a failure ambiguous between the two.
 *
 * <p>Reports through `Log.i`, because an activity has no stdout. The harness
 * reads logcat.
 */
public final class ProbeActivity extends Activity {
    static final String TAG = "NtsProxyProbe";

    static String describe(String url) {
        try {
            List<Proxy> found = ProxySelector.getDefault().select(new URI(url));
            StringBuilder out = new StringBuilder();
            for (Proxy one : found) {
                if (out.length() != 0) {
                    out.append("; ");
                }
                if (one.type() == Proxy.Type.DIRECT) {
                    out.append("DIRECT");
                } else if (one.address() instanceof InetSocketAddress) {
                    InetSocketAddress at = (InetSocketAddress) one.address();
                    String host = at.getHostString();
                    if (host != null && host.indexOf(':') >= 0 && host.charAt(0) != '[') {
                        host = "[" + host + "]";
                    }
                    out.append(one.type() == Proxy.Type.SOCKS ? "SOCKS" : "PROXY")
                       .append(" ").append(host).append(":").append(at.getPort());
                } else {
                    out.append(one.type());
                }
            }
            return out.length() == 0 ? "DIRECT" : out.toString();
        } catch (Exception e) {
            return "THREW " + e.getClass().getName();
        }
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // The properties as this process received them, which is the half a
        // bare `app_process` never gets.
        Log.i(TAG, "http.proxyHost=" + System.getProperty("http.proxyHost")
            + " http.proxyPort=" + System.getProperty("http.proxyPort")
            + " nonProxyHosts=" + System.getProperty("http.nonProxyHosts"));
        Log.i(TAG, "remote=" + describe("http://example.com/a"));
        Log.i(TAG, "loopback=" + describe("http://127.0.0.1:8080/b"));
        Log.i(TAG, "done");
        finish();
    }
}
