/* The libuv host, driven by the main thread's CFRunLoop.
 *
 * A Cocoa program runs `[NSApp run]` (or `CFRunLoopRun`) from its own code, and
 * that call turns the main run loop until the application stops -- from inside
 * module evaluation, with the program's frames still on the stack. libuv never
 * gets a turn, so a `setTimeout` or a promise job posted as a task would wait
 * until the application quit.
 *
 * This is the CoreFoundation twin of `nts_glib_host`: a `CFFileDescriptor` on
 * libuv's backend descriptor (kqueue here), a `CFRunLoopTimer` armed to libuv's
 * next timeout, and a before-waiting observer that re-arms it, all in the
 * common modes, so event tracking and modal panels keep libuv turning too. Each
 * pump runs inside its own autorelease pool, so what a task autoreleases is
 * given back when the task ends rather than when the program does.
 *
 * The host underneath is `nts_uv_host`, unchanged, and `nts_uv_host_pump` does
 * nothing while libuv is already running, which is what makes a modal loop
 * inside a task safe. */
#ifndef NTS_CF_HOST_H
#define NTS_CF_HOST_H

/* Nothing of libuv or CoreFoundation here: this header is included beside
 * whatever a program's own native code includes. */

/* Attach to the main run loop, after `nts_uv_host_install`. */
void nts_cf_host_attach(void);
/* Detach, before `nts_uv_host_shutdown`. */
void nts_cf_host_detach(void);

#endif /* NTS_CF_HOST_H */
