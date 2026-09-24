/* What a program that counts GObjects needs of GObject beyond counting them.
 *
 * Compiled only into a program that connects a signal -- one whose `program.c`
 * calls `nts_gobject_connect` -- because that is what brings libgobject into
 * the link: a program on GLib's loop alone links glib-2.0 and nothing else. */
#ifndef NTS_GOBJECT_H
#define NTS_GOBJECT_H

#include <glib-object.h>

/* `g_signal_connect_data`, exactly -- the same parameters, and the same
 * `g_cclosure_new[_swap]` and `g_signal_connect_closure` inside -- except that
 * it keeps the `GClosure` it makes, which `g_signal_connect_data` does not
 * hand back.
 *
 * `data` is a closure the program lent (`nts_closure_lend`), and while the
 * connection lasts the instance holds it. A handler capturing its own instance
 * is then a cycle through a foreign object, and the collector finds it only if
 * it is told who holds what (`NtsHolders`): each connection is recorded
 * against its instance, keyed by its `GClosure`, so that one closure connected
 * to two instances is two records and ending one connection removes exactly
 * its own. */
gulong nts_gobject_connect(gpointer instance, const gchar *detailed_signal,
                           GCallback handler, gpointer data,
                           GClosureNotify notify, GConnectFlags flags);

#endif /* NTS_GOBJECT_H */
