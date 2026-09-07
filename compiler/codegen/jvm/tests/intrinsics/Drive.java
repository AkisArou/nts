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
import nts.rt.NtsSocket;
import nts.rt.NtsView;
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

    public static void main(String[] args) throws Exception {
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
    }
}
