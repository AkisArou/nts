#include "sub.h"

#include <stdio.h>

void sub_emit(GObject *instance, const char *signal) {
  g_signal_emit_by_name(instance, signal);
}

void sub_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}

static int watched_gone;

static void sub_watched_finalized(gpointer data, GObject *where) {
  (void)data;
  (void)where;
  watched_gone = 1;
}

void sub_watch(GObject *instance) {
  watched_gone = 0;
  g_object_weak_ref(instance, sub_watched_finalized, NULL);
}

int sub_gone(void) { return watched_gone; }
