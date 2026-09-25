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

/* A class the program writes over a GObject class (`class Counter extends
 * GtkButton`), registered as a `GType` of its own: `name` below `parent`,
 * sized as `parent` is, whose `class_init` writes each entry point into its
 * class struct slot. `slots` is `count` pairs of a byte offset -- C's
 * `offsetof` of the slot, which the binding recorded and its witness checked
 * -- and the entry point written there, and must live as long as the program:
 * a type is never unregistered. Plain `size_t` for `GType`, which is `gsize`,
 * so that `program.c` can declare this without GLib's headers.
 *
 * `make_state` is non-NULL for a class that declares fields: the program's
 * function making the object that holds them, its initialisers run. The
 * instance is then one pointer larger than the parent's, holding that object,
 * made by `instance_init` and given back by `finalize` -- which chains to the
 * parent's -- and `nts_gobject_state` (in `nts_runtime.h`) reads it. */
size_t nts_gobject_register(size_t parent, const char *name, const void *slots,
                            size_t count, void *(*make_state)(void));

/* The parent class's implementation of a virtual function, for chaining up
 * (`super.vfunc_clicked()`): the function pointer at `offset` in the class
 * struct of `parent`, or NULL where the parent leaves the slot empty. */
void *nts_gobject_parent_slot(size_t parent, size_t offset);

/* A signal a class the program writes declares (`WithSignals` in `c:types`),
 * added to its `type` once it is registered: `kinds` spells each parameter,
 * `d` a `double`, `b` a `gboolean`, `s` a UTF-8 string, `o` a `GObject`.
 * Returns its id. */
unsigned nts_gobject_add_signal(size_t type, const char *name,
                                const char *kinds);

/* The id of the signal `name` on the instance's type, which an emit thunk
 * keeps in `cache` -- the type it last looked on, then the id -- so a lookup
 * runs once per type and not once per emit. */
unsigned nts_gobject_signal_id(void *instance, const char *name,
                               size_t cache[2]);

/* One instance of `type`, and one reference to it the caller owns: a floating
 * reference -- a widget's -- is sunk here, so the program counts the same
 * kind of reference whatever the class descends from. */
void *nts_gobject_new(size_t type);

#endif /* NTS_GOBJECT_H */
