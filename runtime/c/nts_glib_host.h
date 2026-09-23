/* The libuv host, driven by GLib's main loop.
 *
 * A GTK program calls `g_application_run` from its own code, and that call
 * iterates the thread-default `GMainContext` until the application quits --
 * from inside module evaluation, with the program's frames still on the
 * stack. libuv never gets a turn, so a `setTimeout`, a promise job posted as a
 * task, or a file read would wait until the window closed.
 *
 * This attaches one `GSource` to the default context that watches libuv's
 * backend descriptor, sleeps no longer than its next timer, and pumps it when
 * either comes due. The host underneath is `nts_uv_host`, unchanged: posting,
 * timers and cross-thread wakeups all go where they went, and only who turns
 * the loop differs. */
#ifndef NTS_GLIB_HOST_H
#define NTS_GLIB_HOST_H

/* Nothing of libuv here: this header is included by programs that also
 * include GTK, and `uv.h` needs `_GNU_SOURCE` defined before the first system
 * header -- which GTK's headers have already included by then. */

/* Attach to the default `GMainContext`, after `nts_uv_host_install`. */
void nts_glib_host_attach(void);
/* Detach, before `nts_uv_host_shutdown`. */
void nts_glib_host_detach(void);

#endif /* NTS_GLIB_HOST_H */
