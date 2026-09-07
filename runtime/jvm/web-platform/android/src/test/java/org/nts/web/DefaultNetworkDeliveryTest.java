package org.nts.web;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * `ConnectivityManager` delivers, and the first network it delivers is not a
 * change.
 *
 * <h2>What this is and what it deliberately is not</h2>
 *
 * <p>{@link DefaultNetworkWatch} decides which default-network events mean the
 * open sockets are dead, and thirteen cases test that decision on a desktop JVM
 * with no `android.*` import. What none of them can show is that
 * `ConnectivityManager` delivers those events at all -- the registration is the
 * half that needs a device.
 *
 * <p>So this asserts two things a desktop cannot, and **does not touch the
 * network interface**. A version that did produce a real Wi-Fi to cellular
 * handover worked once and then hung the device repeatedly; `docs/records/0199`
 * records what it showed and why a case that cannot run twice is not something
 * a ratcheted suite can carry. This one has no such hazard: it registers,
 * observes, and unregisters.
 *
 * <p>What it therefore does not prove is the sweep on a *transition*. That
 * remains measured once and unreproducible, and is written down as such rather
 * than implied by a green line here.
 */
public final class DefaultNetworkDeliveryTest {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    /** Accepts and holds, so a connection stays open unless something closes it. */
    static final class Held implements Runnable {
        final ServerSocket listener;
        final List<Socket> kept = new ArrayList<Socket>();
        volatile boolean stop;

        Held() throws IOException {
            listener = new ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"));
        }

        int port() {
            return listener.getLocalPort();
        }

        @Override
        public void run() {
            while (!stop) {
                try {
                    synchronized (kept) {
                        kept.add(listener.accept());
                    }
                } catch (IOException stopping) {
                    return;
                }
            }
        }

        void close() {
            stop = true;
            try {
                listener.close();
            } catch (IOException ignored) {
                // stopping
            }
        }
    }

    static Context systemContext() {
        try {
            android.os.Looper.prepareMainLooper();
        } catch (Throwable alreadyPrepared) {
            // One per process; a second call is not a reason to stop.
        }
        try {
            Class<?> thread = Class.forName("android.app.ActivityThread");
            Object main = thread.getMethod("systemMain").invoke(null);
            return (Context) thread.getMethod("getSystemContext").invoke(main);
        } catch (Throwable unavailable) {
            return null;
        }
    }

    public static void main(String[] args) throws Exception {
        Context context = systemContext();
        if (context == null) {
            // Announced, because a skip that prints nothing reads as a pass.
            System.out.println("SKIP delivery: no system Context in this process");
            return;
        }
        ConnectivityManager manager =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) {
            System.out.println("SKIP delivery: no ConnectivityManager");
            return;
        }

        // **One: the platform delivers.** `registerDefaultNetworkCallback`
        // reports the current default immediately, so this needs no transition
        // -- which is the whole reason it is stable where a handover was not.
        final CountDownLatch delivered = new CountDownLatch(1);
        ConnectivityManager.NetworkCallback listening =
            new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    delivered.countDown();
                }
            };
        manager.registerDefaultNetworkCallback(listening);
        boolean platformDelivers;
        try {
            platformDelivers = delivered.await(15, TimeUnit.SECONDS);
        } finally {
            manager.unregisterNetworkCallback(listening);
        }
        if (!platformDelivers) {
            // **A skip rather than a failure, because this cannot tell the two
            // apart.** No delivery means either that the provider would never
            // be driven or that this device has no default network to report.
            // Failing would accuse the code under test on a device with the
            // radio off, which is the mistake `docs/records/0197` is about;
            // printing nothing would let a dead instrument read as a pass.
            //
            // It is not the flakiness this file used to have. That was a
            // missing `System.exit` below, and the accumulated `TRACK_DEFAULT`
            // registrations were its consequence rather than its cause -- see
            // the comment there.
            System.out.println("SKIP delivery: ConnectivityManager reported no default network "
                + "in fifteen seconds, so this device cannot show whether `watchDefaultNetwork` "
                + "would be driven.");
            return;
        }

        // **Two: the first network is not a change.** `DefaultNetworkWatch` says
        // so and thirteen desktop cases agree, but only here is it a *real*
        // callback -- and getting this wrong closes every connection made
        // between construction and the first delivery, which is a real window.
        Held server = new Held();
        Thread peer = new Thread(server, "delivery-peer");
        peer.setDaemon(true);
        peer.start();

        ExecutorService lane = Executors.newSingleThreadExecutor();
        final List<String> errors = new ArrayList<String>();
        NetworkPrimitives api = new NetworkPrimitives(
            lane, host -> true, (name, message) -> errors.add(name + ": " + message), 8);
        AutoCloseable watching = null;
        try {
            final CountDownLatch opened = new CountDownLatch(2);
            for (int i = 0; i < 2; i++) {
                api.connect("127.0.0.1", server.port(), false, 4000,
                    new NetworkPrimitives.ConnectCallback() {
                        @Override public void success(int handle) { opened.countDown(); }
                        @Override public void failure(String name, String message) {
                            errors.add(name + ": " + message);
                            opened.countDown();
                        }
                    });
            }
            check(opened.await(10, TimeUnit.SECONDS), "the connections did not open");
            check(api.openSocketCount() == 2,
                "expected 2 open connections, have " + api.openSocketCount());

            watching = AndroidNetworking.watchDefaultNetwork(context, api);
            // The registration's own first delivery lands in this window.
            Thread.sleep(3000);
            check(api.openSocketCount() == 2,
                "registering the watch closed " + (2 - api.openSocketCount())
                    + " connection(s): the first network delivered was treated as a change, "
                    + "which would close everything opened before the callback arrived");
        } finally {
            if (watching != null) {
                try {
                    watching.close();
                } catch (Exception ignored) {
                    // unregistering is best effort during teardown
                }
            }
            api.close();
            lane.shutdown();
            server.close();
        }

        System.out.printf("delivery: %d checks, %d failures%n", checks, failures);
        // **Exit rather than return, and that is the whole of the flakiness.**
        // `prepareMainLooper` and `ActivityThread.systemMain` start non-daemon
        // threads, so returning from `main` leaves the VM alive with every
        // check already printed and passing. The harness then kills the process
        // on its timeout -- and a killed process is exactly the one whose
        // `ConnectivityManager` registrations are never reclaimed. That is
        // where the twenty `TRACK_DEFAULT` requests owned by dead root pids
        // came from: four per killed run, accumulating until the platform
        // stopped delivering.
        //
        // So the leak was downstream of the hang, not its cause, and the hang
        // was one missing line. The `finally` above has already unregistered
        // by the time we get here; this just lets the process go.
        System.exit(failures == 0 ? 0 : 1);
    }
}
