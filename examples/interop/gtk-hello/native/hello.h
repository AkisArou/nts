// The part of GTK a TypeScript program cannot reach yet, and nothing else.
//
// Each function here stands in for one missing compiler capability, named
// beside it. Each step of docs/gtk-lane-goal.md deletes the functions it makes
// unnecessary; a shim function that outlives its reason is the thing to look
// for when reading this file.
#ifndef NTS_GTK_HELLO_H
#define NTS_GTK_HELLO_H

#include <gtk/gtk.h>

// `g_signal_connect_data`, at the types a `Closure<F>` produces. Three things
// keep TypeScript from declaring the real one: its instance is a `gpointer`,
// which a `Class` handle cannot be passed as yet; its handler is a `GCallback`,
// `void (*)(void)`, which erases the signature the bridge needs; and its
// destroy notify is a `GClosureNotify`, which takes the closure as a second
// argument.
gulong hello_connect(GObject *instance, const char *signal,
                     void (*handler)(GObject *, void *), void *data,
                     void (*notify)(void *));
// A downcast: `gtk_application_window_new` returns a `GtkWidget *`, and
// `GTK_WINDOW(w)` is a checked cast, which is a runtime question and not a
// conversion the compiler can prove. Upcasts need nothing here.
GtkWindow *hello_as_window(GtkWidget *widget);
// `g_signal_emit_by_name` is variadic over the signal's own arguments.
void hello_click(GtkWidget *button);
// `g_object_unref` takes a `gpointer`, which a `Class` handle cannot be
// passed as yet; and whose reference it gives up is the ownership question.
void hello_unref(GtkApplication *app);
// Output: a compiled program has no `console` without the node modules, and
// `c:*` has no stdio.
void hello_report(int clicks, int status);

#endif
