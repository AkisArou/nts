// What the generated bindings cannot reach yet, and nothing else: each is a
// function GIR describes in a shape the binder refuses today, named beside it.
#ifndef NTS_GTK_GIR_H
#define NTS_GTK_GIR_H

#include <gtk/gtk.h>

// `g_signal_connect_data`: GIR marks it not introspectable.
gulong gir_connect(GObject *instance, const char *signal,
                   void (*handler)(GObject *, void *), void *data,
                   void (*notify)(void *));
// `g_application_run`: `argv` is an array.
int gir_run(GApplication *app);
// `g_object_unref`: a `gpointer`.
void gir_unref(GObject *object);
// `gtk_label_get_text`: returns a string. Prints it.
void gir_log_label(GtkLabel *label);
// Output.
void gir_log(const char *line);

#endif
