#include "cycles.h"

#include <stdio.h>

static int finalized;

static void gone(gpointer data, GObject *object) {
  (void)data;
  (void)object;
  finalized++;
}

void cycles_track(GObject *object) { g_object_weak_ref(object, gone, NULL); }

int cycles_finalized(void) { return finalized; }

size_t nts_cycle_candidates(void);
size_t cycles_candidates(void) { return nts_cycle_candidates(); }

static GObject *pending;

static gboolean emit_now(gpointer data) {
  (void)data;
  g_object_notify(pending, "label");
  return G_SOURCE_REMOVE;
}

/* Five, so that dropping them takes the count below what the collector last
 * read -- which makes it look -- while the emission's own references are the
 * only ones outside the cycle. */
void cycles_emit_later(GObject *object) {
  pending = object;
  for (int i = 0; i < 5; i++) {
    g_object_ref(object);
  }
  g_idle_add(emit_now, NULL);
}

void cycles_drop(void) {
  for (int i = 0; i < 5; i++) {
    g_object_unref(pending);
  }
}

void cycles_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
