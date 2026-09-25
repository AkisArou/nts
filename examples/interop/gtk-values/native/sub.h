// What the generated bindings cannot reach yet: `g_signal_emit_by_name`
// (varargs, so GIR marks it not introspectable), and output.
#ifndef NTS_GTK_SUBCLASS_H
#define NTS_GTK_SUBCLASS_H

#include <gtk/gtk.h>

void sub_emit(GObject *instance, const char *signal);
void sub_log(const char *line);
/* A weak watch on one object: `sub_gone` answers whether it has been
 * finalized since `sub_watch`. */
void sub_watch(GObject *instance);
int sub_gone(void);

#endif
