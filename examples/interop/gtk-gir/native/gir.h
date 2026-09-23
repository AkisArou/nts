// What the generated bindings cannot reach yet, and nothing else: each is a
// function GIR describes in a shape the binder refuses today, named beside it.
#ifndef NTS_GTK_GIR_H
#define NTS_GTK_GIR_H

#include <gtk/gtk.h>

// `g_signal_emit_by_name`: varargs, so GIR marks it not introspectable.
void gir_emit(GObject *instance, const char *signal);
// Output.
void gir_log(const char *line);

#endif
