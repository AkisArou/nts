// What the program observes GTK with, and nothing else.
#ifndef NTS_GTK_CYCLES_H
#define NTS_GTK_CYCLES_H

#include <gtk/gtk.h>

// Counts the object's finalization, through a weak reference.
void cycles_track(GObject *object);
int cycles_finalized(void);
// Candidates the collector has been handed so far.
size_t cycles_candidates(void);
// Five references to `object`, and an idle that notifies on it; the first
// handler drops them with `cycles_drop`, mid-emission.
void cycles_emit_later(GObject *object);
void cycles_drop(void);
void cycles_log(const char *line);

#endif
