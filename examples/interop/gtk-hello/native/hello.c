#include "hello.h"

#include <stdio.h>
#include <stdlib.h>

GtkWindow *hello_as_window(GtkWidget *widget) { return GTK_WINDOW(widget); }

void hello_on_activate(GtkApplication *app,
                       void (*handler)(GtkApplication *, struct hello_state *),
                       struct hello_state *state) {
  g_signal_connect(app, "activate", G_CALLBACK(handler), state);
}

// The control arm: with HELLO_UNCONNECTED set, the handler is never
// connected, so the clicks happen and nothing counts them. build.sh requires
// that arm to fail its check.
void hello_on_clicked(GtkWidget *button,
                      void (*handler)(GtkWidget *, struct hello_state *),
                      struct hello_state *state) {
  if (getenv("HELLO_UNCONNECTED") != NULL)
    return;
  g_signal_connect(button, "clicked", G_CALLBACK(handler), state);
}

void hello_click(GtkWidget *button) {
  g_signal_emit_by_name(button, "clicked");
}

int hello_run(GtkApplication *app) {
  return g_application_run(G_APPLICATION(app), 0, NULL);
}

void hello_quit(GtkApplication *app) { g_application_quit(G_APPLICATION(app)); }

void hello_unref(GtkApplication *app) { g_object_unref(app); }

void hello_report(int clicks, int status) {
  printf("clicks=%d status=%d\n", clicks, status);
}
