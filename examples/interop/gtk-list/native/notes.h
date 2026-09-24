// What the bindings cannot reach: `g_signal_emit_by_name` is variadic.
#ifndef NTS_GTK_NOTES_H
#define NTS_GTK_NOTES_H

#include <gtk/gtk.h>

// Emits `signal` on `instance`, as a click or a keypress would.
void notes_emit(GObject *instance, const char *signal);
void notes_log(const char *line);

#endif
