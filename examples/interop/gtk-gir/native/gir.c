#include "gir.h"

#include <stdio.h>

gulong gir_connect(GObject *instance, const char *signal,
                   void (*handler)(GObject *, void *), void *data,
                   void (*notify)(void *)) {
  return g_signal_connect_data(instance, signal, G_CALLBACK(handler), data,
                               (GClosureNotify)(void (*)(void))notify, 0);
}

int gir_run(GApplication *app) { return g_application_run(app, 0, NULL); }

void gir_unref(GObject *object) { g_object_unref(object); }

void gir_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
