import java.io.IOException;
import java.lang.reflect.Method;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;

import nts.rt.NtsEnv;
import nts.rt.NtsInbox;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsBuffer;
import nts.rt.NtsRefusal;
import nts.rt.NtsSocket;
import nts.rt.NtsView;
import nts.rt.NtsWeb;
import nts.rt.NtsViewU8;
import nts.rt.NtsTextPairCallback;

/**
 * Java opens the sockets; the compiled TypeScript counts them.
 *
 * The direction is the whole point. Every other suite in this lane calls
 * `nts.rt` from Java and asserts on what Java sees, which cannot distinguish a
 * working runtime from a working runtime a program cannot reach. Here the
 * state is created on one side of the intrinsic boundary and observed on the
 * other, so a wrong entry in the extern table -- a name mapped to a method that
 * also returns a double -- changes a number rather than nothing.
 */
public final class Drive {
    /** Accepts and holds, so a connection stays open until someone closes it. */
    static final class Listener implements Runnable {
        final ServerSocket listener;
        final List<Socket> held = new ArrayList<Socket>();
        volatile boolean stop;

        Listener() throws IOException {
            listener = new ServerSocket(0, 16, java.net.InetAddress.getByName("127.0.0.1"));
        }

        int port() {
            return listener.getLocalPort();
        }

        @Override
        public void run() {
            while (!stop) {
                try {
                    Socket accepted = listener.accept();
                    synchronized (held) {
                        held.add(accepted);
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
            synchronized (held) {
                for (Socket one : held) {
                    try {
                        one.close();
                    } catch (IOException ignored) {
                        // stopping
                    }
                }
            }
        }
    }

    /** Reads five bytes and writes them straight back, once, then closes. */
    static final class Echo implements Runnable {
        final ServerSocket listener;
        volatile boolean stop;

        Echo() throws IOException {
            listener = new ServerSocket(0, 4, java.net.InetAddress.getByName("127.0.0.1"));
        }

        int port() {
            return listener.getLocalPort();
        }

        @Override
        public void run() {
            try {
                Socket peer = listener.accept();
                byte[] seen = new byte[5];
                int at = 0;
                while (at < seen.length) {
                    int n = peer.getInputStream().read(seen, at, seen.length - at);
                    if (n < 0) {
                        break;
                    }
                    at += n;
                }
                peer.getOutputStream().write(seen, 0, at);
                peer.getOutputStream().flush();
                peer.close();
            } catch (IOException stopping) {
                // the listener was closed, which is how this ends
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

    /** Call an exported function that answers nothing. */
    static void run(String method, double... argument) throws Exception {
        Class<?> program = Class.forName("nts.gen.Program");
        if (argument.length == 0) {
            program.getMethod(method).invoke(null);
        } else {
            program.getMethod(method, double.class).invoke(null, Double.valueOf(argument[0]));
        }
    }

    /**
     * A round trip driven from the compiled TypeScript.
     *
     * <p>Java owns the peer and the loop; the program owns the connection. Each
     * step starts an operation and returns, because a completion arrives when
     * the environment is drained and only this side can drain it -- which is
     * also the shape a provider written in TypeScript would have.
     */
    static void roundTrip() throws Exception {
        Echo echo = new Echo();
        Thread thread = new Thread(echo, "intrinsic-echo");
        thread.setDaemon(true);
        thread.start();

        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            run("dial", echo.port());
            NtsEnv.drain(env);
            System.out.println("round-trip open " + (int) call("status")
                + " live " + (int) NtsSocket.openCount());

            run("send");
            NtsEnv.drain(env);
            System.out.println("round-trip wrote " + (int) call("written"));

            run("receive");
            NtsEnv.drain(env);
            System.out.println("round-trip read " + (int) call("received"));
            System.out.println("round-trip checksum " + (int) call("checksum"));

            run("shut");
        } catch (Throwable failed) {
            // Printed here because the `finally` below closes the environment,
            // and closing one with an unsettled completion throws -- so the
            // refusal about a held credit replaces whatever actually went
            // wrong. Every diagnosis in this file so far has been of the
            // second exception rather than the first.
            Throwable cause = failed instanceof java.lang.reflect.InvocationTargetException
                ? ((java.lang.reflect.InvocationTargetException) failed).getCause()
                : failed;
            System.out.println("round-trip failed: " + cause + " -- " + text("whyItFailed"));
            throw failed;
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            echo.close();
        }
    }

    /** The two closures a completion is, held together for the test's convenience. */
    static final class Result implements NtsNumberCallback, NtsTextPairCallback {
        double handle = Double.NaN;
        String name;

        @Override
        public void call(double value) {
            handle = value;
        }

        @Override
        public void call(String code, String message) {
            name = code;
        }
    }

    /** The compiled TypeScript, reached the way the differential reaches it. */
    static double call(String method, double... argument) throws Exception {
        Class<?> program = Class.forName("nts.gen.Program");
        Method found = argument.length == 0
            ? program.getMethod(method)
            : program.getMethod(method, double.class);
        Object answer = argument.length == 0
            ? found.invoke(null)
            : found.invoke(null, Double.valueOf(argument[0]));
        return ((Double) answer).doubleValue();
    }

    /** An exported function that answers a string. */
    static String text(String method) throws Exception {
        return (String) Class.forName("nts.gen.Program").getMethod(method).invoke(null);
    }

    public static void main(String[] args) throws Exception {
        // The module initializer, which is what allocates a module-level
        // `const inbound = new Uint8Array(16)`. The JVM's own `<clinit>` sets
        // the scalar globals to their constants; anything that has to be
        // *built* is in here, and a driver that does not call it reads null --
        // which is what the differential's harness does and this did not.
        Class.forName("nts.gen.Program").getMethod("module$init").invoke(null);

        Listener server = new Listener();
        Thread thread = new Thread(server, "intrinsic-listener");
        thread.setDaemon(true);
        thread.start();

        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            // Three, because one would not tell a count from a boolean and two
            // would not tell a count from a toggle.
            Result[] opened = new Result[3];
            for (int i = 0; i < opened.length; i++) {
                opened[i] = new Result();
                NtsInbox.Slot slot = NtsEnv.launch(env);
                NtsSocket.connect(env, slot, "127.0.0.1", server.port(), false, 4000,
                    opened[i], opened[i]);
            }
            NtsEnv.drain(env);
            for (Result one : opened) {
                if (one.name != null) {
                    System.out.println("connect failed " + one.name);
                    return;
                }
            }

            // How many of thirty-two bytes the fill set. A stub answers 0.
            System.out.println("random " + ((int) call("randomBytes") > 0 ? "set" : "none"));

            // The window property, which TypeScript cannot express yet: `new
            // Uint8Array(backing, 8, 16)` does not lower, so there is no way to
            // build a view onto part of a buffer from a program. Asserted here
            // instead, because a fill that ignored the view's offset and length
            // would answer correctly on every case that can be written above --
            // every one of those views starts at zero and spans the whole
            // buffer, which is exactly the shape that hides the bug.
            NtsBuffer backing = NtsBuffer.allocate(32);
            NtsViewU8 window = NtsViewU8.part(backing, 8, 16);
            NtsSocket.randomFill(window);
            byte[] bytes = NtsBuffer.storage(backing);
            int outside = 0;
            int inside = 0;
            for (int i = 0; i < 32; i++) {
                if (i < 8 || i >= 24) {
                    if (bytes[i] != 0) { outside++; }
                } else if (bytes[i] != 0) {
                    inside++;
                }
            }
            System.out.println("outside " + outside);
            System.out.println("inside " + (inside > 0 ? "set" : "none"));

            // Byte ownership: a read into a view whose buffer has been
            // detached never starts. Synchronous, unlike every failure the
            // callbacks carry, because a detached buffer is not an *outcome*
            // of the operation -- which is what the language specifies and
            // what node does.
            //
            // Asserted here rather than from TypeScript because a program
            // cannot get there: `new Uint8Array(buffer)` does not lower, so
            // there is no way to hold a view whose buffer something else can
            // detach. The runtime property is real either way and this is the
            // only place that can state it.
            NtsBuffer doomed = NtsBuffer.allocate(16);
            NtsViewU8 over = NtsViewU8.over(doomed, 0);
            NtsBuffer.transfer(doomed, 16, true);
            String refused;
            try {
                NtsWeb.read(0, over, null, null);
                refused = "no";
            } catch (NtsRefusal caught) {
                refused = caught.getMessage().contains("detached") ? "TypeError" : "wrong";
            }
            System.out.println("detached read " + refused);

            System.out.println("open " + (int) call("openNow"));
            System.out.println("after close " + (int) call("closeOne", opened[0].handle));

            // A request id no `connect` ever returned. Idempotent, and it must
            // not close the two still open.
            System.out.println("after cancel " + (int) call("cancelUnissued", 987654));

            System.out.println("changed " + (int) call("changed"));
            System.out.println("open " + (int) call("openNow"));

            // And again, because the second sweep has nothing to close and must
            // say so rather than repeat the first answer.
            System.out.println("changed " + (int) call("changed"));
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            server.close();
        }

        // Last, and in its own environment: it opens a real connection through
        // the compiled program, and the counts above are asserted against a
        // provider holding nothing else.
        roundTrip();
        NtsSocket.shutdown();

        // The durable store, through the same compiled program. Configured from
        // here because the root is a path this process owns and there is no way
        // to hand a string to a reflected entry point; everything after it is
        // the program's own calls through the intrinsic table.
        // `Files.createTempDirectory` and not `ProcessHandle.current().pid()`:
        // this file compiles at `--release 8` like everything else in the lane,
        // and `ProcessHandle` arrived in 9.
        java.io.File root =
            java.nio.file.Files.createTempDirectory("nts-intrinsic-store").toFile();
        nts.rt.NtsWeb.storeConfigure(root.getPath());
        System.out.println("store " + text("storeRoundTrip"));
        nts.rt.NtsWeb.storeClose();
        clear(root);

        // The proxy formatting, with nothing configured and then with a proxy
        // and a bypass list. The properties are set here rather than in the
        // compiled program because they are the *platform's* configuration --
        // what a framework-started app has done to it, not something a program
        // decides -- and this is the nearest a desktop JVM gets to that.
        System.out.println("proxy " + text("proxyFor"));
        System.setProperty("http.proxyHost", "proxy.test");
        System.setProperty("http.proxyPort", "3128");
        System.setProperty("http.nonProxyHosts", "localhost|127.0.0.1");
        System.out.println("proxy " + text("proxyFor"));
        System.out.println("proxy " + text("proxyForBypassed"));
        System.clearProperty("http.proxyHost");
        System.clearProperty("http.proxyPort");
        System.clearProperty("http.nonProxyHosts");
    }

    /** Recursively, so a rerun does not read the last run's values. */
    static void clear(java.io.File at) {
        java.io.File[] inside = at.listFiles();
        if (inside != null) {
            for (java.io.File one : inside) {
                clear(one);
            }
        }
        at.delete();
    }
}
