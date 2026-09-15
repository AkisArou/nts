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

    /**
     * Counted down once the worker has returned from the callback.
     *
     * <p>**This is what lets a test tell delivery from the race it replaced.**
     * Both leave the same value behind: posting the work and running it on the
     * loader's thread each end with the number written. They differ in *when* --
     * a posted callback has not run when `onBytes` returns, and a directly
     * called one has. Without this latch a test can only race the worker, and a
     * deliberately broken delivery passes it, which is how this fixture read
     * green while running the TypeScript on the wrong thread.
     */
    private static final java.util.concurrent.CountDownLatch RETURNED =
        new java.util.concurrent.CountDownLatch(1);

    /**
     * Block until the worker has returned from the callback.
     *
     * <p>A method rather than the latch itself, so the published surface gains
     * no type: a `public` field of type `CountDownLatch` puts
     * `java.util.concurrent` into the generated declarations, and the curated
     * prelude carries `java.lang` and `java.util` only. The binder was right to
     * surface it and the fixture was wrong to offer it.
     */
    public static void awaitReturned() throws InterruptedException {
        RETURNED.await();
    }

    /** Runs `callback` on a background thread, as a real network load would. */
    public static void load(final String what, final OnBytes callback) {
        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                byte[] data = what.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                callback.onBytes(data);
                RETURNED.countDown();
            }
        }, "loader");
        worker.setDaemon(true);
        worker.start();
    }
}
