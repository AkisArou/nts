#include "gir.h"

#include <stdio.h>

void gir_emit(GObject *instance, const char *signal) {
  g_signal_emit_by_name(instance, signal);
}

void gir_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
