package com.example.ui;

/**
 * A void callback delivered on a FOREIGN thread.
 *
 * <p>This is the other shape, and the distinction is the whole point of this
 * project: the framework has nowhere to put a return value either, so the
 * callback is `void` by convention, and posting it to the inbox to run on our
 * lane loses nothing.
 */
public final class Loader {

    public interface OnBytes {
        void onBytes(byte[] data);
    }

    /** Runs `callback` on a background thread, as a real network load would. */
    public static void load(final String what, final OnBytes callback) {
        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                byte[] data = what.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                callback.onBytes(data);
            }
        }, "loader");
        worker.setDaemon(true);
        worker.start();
    }
}
