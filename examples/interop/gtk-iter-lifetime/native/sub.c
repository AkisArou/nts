#include "sub.h"

#include <stdio.h>

void sub_emit(GObject *instance, const char *signal) { g_signal_emit_by_name(instance, signal); }

void sub_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
