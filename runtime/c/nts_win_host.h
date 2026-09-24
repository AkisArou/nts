/* The libuv host, driven by a Win32 message loop.
 *
 * A Win32 program runs `GetMessageW`/`DispatchMessageW` from its own code, and
 * that loop turns until `WM_QUIT` -- from inside module evaluation, with the
 * program's frames still on the stack. libuv never gets a turn, so a
 * `setTimeout` or a promise job posted as a task would wait until the window
 * closed.
 *
 * libuv on Windows is IOCP and has no descriptor to watch, so this is not the
 * GLib or CoreFoundation shape. A watcher thread blocks on libuv's completion
 * port with libuv's own timeout, puts back whatever it dequeued, and posts one
 * message to a message-only window; that window's procedure pumps libuv on the
 * owner thread and re-arms the watcher. The program's loop delivers the
 * message like any other, and so does every modal loop Windows runs for it (a
 * `MessageBox`, a window being resized), so libuv keeps turning through those
 * too. Electron embeds node in the same way.
 *
 * Work scheduled outside a pump -- a timer started from a window procedure --
 * posts no completion, so the host shortens the watcher's wait itself
 * (`nts_uv_host_on_schedule`).
 *
 * **Every Windows executable attaches it**, not only one seen to pump
 * messages: guessing that from what a program calls fails as a silent hang.
 * A console program never dispatches the wake message, so the watcher wakes
 * once, finds nothing re-arming it, and stays parked while `uv_run` drives
 * libuv as usual. A packet it took in that one wake was put back. */
#ifndef NTS_WIN_HOST_H
#define NTS_WIN_HOST_H

/* Nothing of libuv or <windows.h> here: this header is included beside
 * whatever a program's own native code includes. */

/* Attach to the calling thread's message queue, after `nts_uv_host_install`. */
void nts_win_host_attach(void);
/* Detach, before `nts_uv_host_shutdown`. */
void nts_win_host_detach(void);

#endif /* NTS_WIN_HOST_H */
