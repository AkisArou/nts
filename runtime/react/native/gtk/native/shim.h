// What the generated bindings cannot reach, and nothing else.
#ifndef REACT_GTK_SHIM_H
#define REACT_GTK_SHIM_H

#include <gtk/gtk.h>

// `g_signal_emit_by_name`: varargs, so GIR marks it not introspectable.
void react_gtk_emit(GObject *instance, const char *signal);
// Output, for build.sh to read.
void react_gtk_log(const char *line);

#endif
