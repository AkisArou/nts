// What the generated bindings cannot reach, and nothing else.
#ifndef REACT_GTK_SHIM_H
#define REACT_GTK_SHIM_H

#include <gtk/gtk.h>

// `g_signal_emit_by_name`: varargs, so GIR marks it not introspectable.
void react_gtk_emit(GObject *instance, const char *signal);
// The same, for a signal whose one argument is a double.
void react_gtk_emit_double(GObject *instance, const char *signal, double value);
// Output, for build.sh to read.
void react_gtk_log(const char *line);

#endif
