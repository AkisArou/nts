import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;

import nts.rt.NtsEnv;
import nts.rt.NtsInbox;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsSocket;
import nts.rt.NtsTextPairCallback;

/**
 * The I/O queue is bounded, and this is the case that reaches the bound.
 *
 * <p>`NtsSocket.submit` catches `RejectedExecutionException` and says of it
 * "the queue is bounded, so this is reachable" -- a claim with no test behind
 * it. The pool is 8 workers over a 256-deep queue, so 265 operations in flight
 * is what it takes, and nothing in this lane had ever asked for more than a
 * handful.
 *
 * <p>Two things have to hold when it is reached, and the second is the one that
 * matters. The refusal must arrive **through the failure callback** rather than
 * being thrown at the caller, for the reason every other refusal here does:
 * a program would otherwise see `QueueFull` at a different position in the task
 * order than a connection refusal, so its output would depend on which failure
 * happened rather than on the fact that one did. And the completion credit must
 * come back -- the work was refused at submission, before any platform work
 * existed, so the caller's reservation is still the caller's.
 *
 * <p>A credit leaked here is invisible until an environment is closed, which is
 * where it is finally counted. That is a long way from the line that leaked it.
 */
public final class SaturateTest {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    /** Accepts and says nothing, so every read blocks until its socket is closed. */
    static final class Silent implements Runnable {
        final ServerSocket listener;
        final List<Socket> held = new ArrayList<Socket>();
        volatile boolean stop;

        Silent() throws IOException {
            listener = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
        }

        int port() {
            return listener.getLocalPort();
        }

        @Override
        public void run() {
            while (!stop) {
                try {
                    Socket peer = listener.accept();
                    synchronized (held) {
                        held.add(peer);
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

    static final class Opened implements NtsNumberCallback, NtsTextPairCallback {
        double handle = Double.NaN;
        String name;

        @Override public void call(double value) { handle = value; }
        @Override public void call(String code, String message) { name = code; }
    }

    /** Counts what the reads were told, without caring which read said it. */
    static final class Tally implements NtsNumberCallback, NtsTextPairCallback {
        int settled;
        int queueFull;
        int otherFailures;
        String firstOther;

        @Override
        public void call(double count) {
            settled++;
        }

        @Override
        public void call(String code, String message) {
            settled++;
            if ("QueueFull".equals(code)) {
                queueFull++;
            } else {
                otherFailures++;
                if (firstOther == null) {
                    firstOther = code + ": " + message;
                }
            }
        }
    }

    public static void main(String[] args) throws Exception {
        Silent server = new Silent();
        Thread thread = new Thread(server, "saturate-silent");
        thread.setDaemon(true);
        thread.start();

        // Deeper than the number of operations, so the *inbox* never refuses
        // first: this is a test of the worker queue, and `Backpressure` from a
        // full inbox would look like a pass while proving something else.
        final int reads = 400;
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, reads + 64);
        NtsEnv previous = NtsEnv.enterEnv(env);
        Tally tally = new Tally();
        int issued = 0;
        try {
            List<Double> handles = new ArrayList<Double>();
            for (int i = 0; i < 12; i++) {
                Opened opened = new Opened();
                NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", server.port(), false,
                    4000, opened, opened);
                NtsEnv.drain(env);
                check(opened.name == null, "connect " + i + " failed: " + opened.name);
                handles.add(Double.valueOf(opened.handle));
            }

            // Every read blocks: the peer says nothing. Eight take the workers,
            // 256 fill the queue, and the rest have nowhere to go.
            byte[] into = new byte[16];
            for (int i = 0; i < reads; i++) {
                NtsInbox.Slot slot = NtsEnv.launch(env);
                check(slot != null, "the inbox refused before the queue could -- "
                    + "raise its capacity, this test is about the other bound");
                if (slot == null) {
                    break;
                }
                issued++;
                double handle = handles.get(i % handles.size()).doubleValue();
                NtsSocket.read(env, slot, handle, into, 0, into.length, tally, tally);
            }

            // Closing is what unblocks a worker parked in `read`, which is the
            // same mechanism `networkChanged` relies on.
            for (Double handle : handles) {
                NtsSocket.close(handle.doubleValue());
            }
            NtsEnv.drain(env);

            // **The arithmetic, not just the fact.** Eight workers over a
            // 256-deep queue admits exactly 264 blocked operations, and every
            // read after that has nowhere to go. Asserting only "something was
            // refused" would pass against a pool of one, and the number is the
            // whole claim: it is what says an application on a phone cannot be
            // made to spawn a thread per connect.
            int admitted = tally.settled - tally.queueFull;
            check(admitted == 264,
                admitted + " reads were admitted rather than 264. The pool is 8 workers over "
                    + "a 256-deep queue and every read here blocks, so that sum is the bound "
                    + "itself -- if it moved, this line is where to say so.");
            check(tally.queueFull == issued - 264,
                tally.queueFull + " refused rather than " + (issued - 264));
            check(tally.otherFailures == admitted,
                "the admitted reads reported " + tally.otherFailures + " failures rather than "
                    + admitted + "; every one is unblocked by its socket closing"
                    + (tally.firstOther == null ? "" : ", first was " + tally.firstOther));
            check(tally.settled == issued,
                "settled " + tally.settled + " of " + issued + " reads -- every one must "
                    + "report exactly once, refused or not");
            check(NtsEnv.outstanding(env) == 0.0,
                NtsEnv.outstanding(env) + " completion credit(s) outstanding after every read "
                    + "settled. A refusal at submission never created platform work, so the "
                    + "credit was still the caller's to return.");
        } finally {
            // Closing an environment with a credit outstanding refuses, so this
            // is a second, louder statement of the assertion above.
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            server.close();
            NtsSocket.shutdown();
        }

        System.out.printf("saturate: %d reads, %d refused for a full queue, %d other -- "
            + "%d checks, %d failures%n",
            issued, tally.queueFull, tally.otherFailures, checks, failures);
        if (failures != 0) {
            System.exit(1);
        }
    }
}
