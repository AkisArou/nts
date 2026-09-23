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

// Strings: TS `string` cannot become `const char *`, so the application id
// is fixed here.
GtkApplication *hello_app_new(void);
// Handle casts: `GTK_WINDOW(w)` is a macro and one `Opaque` tag cannot become
// another.
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
// `G_APPLICATION(app)`: a cast again.
int hello_run(GtkApplication *app);
void hello_quit(GtkApplication *app);
void hello_unref(GtkApplication *app);
// Output: a compiled program has no `console` without the node modules, and
// `c:*` has no stdio.
void hello_report(int clicks, int status);

#endif
