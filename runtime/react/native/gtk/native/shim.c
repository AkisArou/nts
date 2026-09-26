#include "shim.h"

#include <stdio.h>

void react_gtk_emit(GObject *instance, const char *signal) {
  g_signal_emit_by_name(instance, signal);
}

void react_gtk_emit_double(GObject *instance, const char *signal, double value) {
  g_signal_emit_by_name(instance, signal, value);
}

int react_gtk_emit_decision(GObject *instance, const char *signal) {
  gboolean handled = FALSE;
  g_signal_emit_by_name(instance, signal, &handled);
  return handled;
}

void react_gtk_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
