// What gtk-loop needs from C: GTK's macros and variadics, the log it prints,
// and the two control arms. See ../gtk-hello/native/hello.h for why each of
// the GTK functions is here rather than declared directly.
#ifndef NTS_GTK_LOOP_H
#define NTS_GTK_LOOP_H

#include <gtk/gtk.h>

gulong loop_connect(GObject *instance, const char *signal,
                    void (*handler)(GObject *, void *), void *data,
                    void (*notify)(void *));
GtkWindow *loop_as_window(GtkWidget *widget);
void loop_unref(GtkApplication *app);

// One line of the log build.sh reads.
void loop_log(const char *line);
// Emit "clicked" from GLib's own dispatch, on an idle source: the handler
// then runs with no compiled code on the stack below it, as a real click does.
void loop_click_later(GtkWidget *button);
// Emit "clicked" now, synchronously, from whatever called this.
void loop_click_now(GtkWidget *button);
// Turn GLib's loop from inside whatever called this -- what a modal dialog,
// a menu or drag and drop does inside a signal handler: every source that is
// ready is dispatched, without blocking.
void loop_spin(void);

// `g_application_quit`, or with LOOP_LINGER=<ms> the same after that long
// idle: nothing of libuv's is alive by then, so the process should sleep, and
// build.sh compares the CPU it used against the time it took.
void loop_quit(GApplication *app);

// The control arms, chosen by LOOP_CONTROL and applied before any callback
// runs. "nodrain" turns the checkpoint after callbacks off; "detached" takes
// libuv's source off GLib's loop. Either way a timeout quits the application
// after three seconds, so an arm that loses its timers still ends.
void loop_control(GApplication *app);

#endif
