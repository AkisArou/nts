#include "shim.h"

#include <stdio.h>

void react_gtk_emit(GObject *instance, const char *signal) {
  g_signal_emit_by_name(instance, signal);
}

void react_gtk_emit_double(GObject *instance, const char *signal, double value) {
  g_signal_emit_by_name(instance, signal, value);
}

int react_gtk_emit_decision(GObject *instance, const char *signal) {
  gboolean handled = FALSE;
  g_signal_emit_by_name(instance, signal, &handled);
  return handled;
}

unsigned react_gtk_emit_choice(GObject *instance, const char *signal, unsigned index) {
  guint chosen = 0;
  g_signal_emit_by_name(instance, signal, index, &chosen);
  return chosen;
}

int react_gtk_emit_key_pressed(GObject *controller, unsigned keyval, unsigned keycode, unsigned state) {
  gboolean handled = FALSE;
  g_signal_emit_by_name(controller, "key-pressed", keyval, keycode, (GdkModifierType)state, &handled);
  return handled;
}

void react_gtk_emit_pressed(GObject *gesture, int n_press, double x, double y) {
  g_signal_emit_by_name(gesture, "pressed", n_press, x, y);
}

void react_gtk_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
