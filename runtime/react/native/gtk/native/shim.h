// What the generated bindings cannot reach, and nothing else.
#ifndef REACT_GTK_SHIM_H
#define REACT_GTK_SHIM_H

#include <gtk/gtk.h>

// `g_signal_emit_by_name`: varargs, so GIR marks it not introspectable.
void react_gtk_emit(GObject *instance, const char *signal);
// The same, for a signal whose one argument is a double.
void react_gtk_emit_double(GObject *instance, const char *signal, double value);
// The same, for a signal whose handlers answer whether they handled it:
// the answer.
int react_gtk_emit_decision(GObject *instance, const char *signal);
// The same, for a signal whose one argument is an unsigned index and whose
// handlers answer with a choice of an enum (a Sidebar's drop-enter): the
// choice.
unsigned react_gtk_emit_choice(GObject *instance, const char *signal, unsigned index);
// A key controller's `key-pressed`, as a key going down: the answer.
int react_gtk_emit_key_pressed(GObject *controller, unsigned keyval, unsigned keycode, unsigned state);
// A click gesture's `pressed`, as the `n_press`th press at (x, y).
void react_gtk_emit_pressed(GObject *gesture, int n_press, double x, double y);
// Output, for build.sh to read.
void react_gtk_log(const char *line);

#endif
