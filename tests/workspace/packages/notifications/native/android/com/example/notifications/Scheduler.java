package com.example.notifications;

/**
 * The Android half. Both directions live here, which is why the package's
 * config declares this root twice with different `direction`s.
 *
 * Outbound: {@link #schedule} and {@link #cancel} are ordinary Java that
 * TypeScript calls through generated bindings.
 *
 * Inbound: {@link #setTapHandler} keeps a TypeScript function and calls it when
 * the user taps. That call arrives on a **Looper thread**, which is foreign to
 * the runtime, so it must be posted rather than invoked -- the sanctioned route
 * is `NtsInbox`. Calling straight through would appear to work on x86 and is
 * the thing `NtsInbox`'s header warns about for ARM.
 */
public final class Scheduler {
    private Object tapHandler;

    public void schedule(String id, String title, String body, double delayMillis) {
        // NotificationManager + AlarmManager in a real one.
    }

    public void cancel(String id) {
    }

    public void setTapHandler(Object handler) {
        this.tapHandler = handler;
    }

    /** Called by the system on tap, from a Looper thread. */
    public void onNotificationTapped(String id) {
        // Posts to the runtime's lane; does not call `tapHandler` directly.
    }
}
