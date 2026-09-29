/* What a program reaches of GTK through the runtime rather than through one
 * of GTK's own symbols, declared for the witness and for a binding's
 * self-check as `nts_gobject.h` is for GObject, and defined in `nts_gtk.c`,
 * which a program that calls one links. */
#ifndef NTS_GTK_H
#define NTS_GTK_H

#include <gtk/gtk.h>

/* `Gtk.CClosureExpression` as GJS makes one from a function: no parameter
 * expressions, and GLib's generic marshaller, which calls `callback` with the
 * evaluated `this` and then `data`, and takes over what it answers --
 * `g_value_take_string` a string, `g_value_take_object` an object -- so the
 * callback's bridge answers an owned one. `notify` gives `data` back when the
 * expression is finalized. */
GtkExpression *nts_gtk_cclosure_expression_new(GType value_type,
                                               GCallback callback,
                                               gpointer data,
                                               GClosureNotify notify);

#endif
