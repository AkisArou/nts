// The part of GTK a TypeScript program cannot reach yet, and nothing else.
//
// Each function here stands in for one missing compiler capability, named
// beside it. M0 of docs/gtk-lane-goal.md measures that list; each later step
// deletes the functions it makes unnecessary. A shim function that outlives its
// reason is the thing to look for when reading this file.
#ifndef NTS_GTK_HELLO_H
#define NTS_GTK_HELLO_H

#include <gtk/gtk.h>

// The program's state, which C hands back to every callback. A capturing
// closure would replace it.
struct hello_state {
  int clicks;
};

// A downcast: `gtk_application_window_new` returns a `GtkWidget *`, and
// `GTK_WINDOW(w)` is a checked cast, which is a runtime question and not a
// conversion the compiler can prove. Upcasts need nothing here.
GtkWindow *hello_as_window(GtkWidget *widget);
// `g_signal_connect` is a macro over a `GCallback`-typed function, and the
// signal name is a string.
void hello_on_activate(GtkApplication *app,
                       void (*handler)(GtkApplication *, struct hello_state *),
                       struct hello_state *state);
void hello_on_clicked(GtkWidget *button,
                      void (*handler)(GtkWidget *, struct hello_state *),
                      struct hello_state *state);
// `g_signal_emit_by_name` is variadic and takes a string.
void hello_click(GtkWidget *button);
// `g_object_unref` takes a `gpointer`, which a `Class` handle cannot be
// passed as yet; and whose reference it gives up is the ownership question.
void hello_unref(GtkApplication *app);
// Output: a compiled program has no `console` without the node modules, and
// `c:*` has no stdio.
void hello_report(int clicks, int status);

#endif
