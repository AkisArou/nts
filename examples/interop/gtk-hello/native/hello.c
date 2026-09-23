#include "hello.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// The control arm: with HELLO_UNCONNECTED set, "clicked" is never connected,
// so the clicks happen and nothing counts them. build.sh requires that arm to
// fail its check. The closure is given back at once, as GLib would on
// disconnect, so the arm leaks nothing the real one would not.
gulong hello_connect(GObject *instance, const char *signal,
                     void (*handler)(GObject *, void *), void *data,
                     void (*notify)(void *)) {
  if (getenv("HELLO_UNCONNECTED") != NULL && strcmp(signal, "clicked") == 0) {
    notify(data);
    return 0;
  }
  // A `GDestroyNotify` where a `GClosureNotify` goes is the cast GLib code
  // writes as `(GClosureNotify) g_free`: the extra closure argument is ignored.
  return g_signal_connect_data(instance, signal, G_CALLBACK(handler), data,
                               (GClosureNotify)(void (*)(void))notify, 0);
}

GtkWindow *hello_as_window(GtkWidget *widget) { return GTK_WINDOW(widget); }

void hello_click(GtkWidget *button) {
  g_signal_emit_by_name(button, "clicked");
}

void hello_unref(GtkApplication *app) { g_object_unref(app); }

void hello_report(int clicks, int status) {
  printf("clicks=%d status=%d\n", clicks, status);
}
