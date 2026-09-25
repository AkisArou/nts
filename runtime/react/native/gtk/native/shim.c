#include "shim.h"

#include <stdio.h>

void react_gtk_emit(GObject *instance, const char *signal) {
  g_signal_emit_by_name(instance, signal);
}

void react_gtk_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
