#include "notes.h"

#include <stdio.h>

void notes_emit(GObject *instance, const char *signal) {
  g_signal_emit_by_name(instance, signal);
}

void notes_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
