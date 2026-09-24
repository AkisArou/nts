#include "loop.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nts_glib_host.h"
#include "nts_runtime.h"

gulong loop_connect(GObject *instance, const char *signal,
                    void (*handler)(GObject *, void *), void *data,
                    void (*notify)(void *)) {
  return g_signal_connect_data(instance, signal, G_CALLBACK(handler), data,
                               (GClosureNotify)(void (*)(void))notify, 0);
}

GtkWindow *loop_as_window(GtkWidget *widget) { return GTK_WINDOW(widget); }

void loop_unref(GtkApplication *app) { g_object_unref(app); }

void loop_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}

static gboolean loop_click_idle(gpointer button) {
  g_signal_emit_by_name(button, "clicked");
  g_object_unref(button);
  return G_SOURCE_REMOVE;
}

void loop_click_later(GtkWidget *button) {
  g_idle_add(loop_click_idle, g_object_ref(button));
}

void loop_click_now(GtkWidget *button) {
  g_signal_emit_by_name(button, "clicked");
}

void loop_spin(void) {
  for (int i = 0; i < 20; i++) {
    g_main_context_iteration(NULL, FALSE);
  }
}

static gboolean loop_quit_now(gpointer app) {
  g_application_quit(app);
  return G_SOURCE_REMOVE;
}

void loop_quit(GApplication *app) {
  const char *linger = getenv("LOOP_LINGER");
  if (linger == NULL || *linger == '\0') {
    g_application_quit(app);
    return;
  }
  g_timeout_add((guint)atoi(linger), loop_quit_now, app);
}

static gboolean loop_give_up(gpointer app) {
  loop_log("gave-up");
  g_application_quit(app);
  return G_SOURCE_REMOVE;
}

void loop_control(GApplication *app) {
  const char *control = getenv("LOOP_CONTROL");
  if (control == NULL || *control == '\0')
    return;
  if (strcmp(control, "nodrain") == 0)
    nts_checkpoint_after_callbacks(false);
  if (strcmp(control, "detached") == 0)
    nts_glib_host_detach();
  g_timeout_add(3000, loop_give_up, app);
}
