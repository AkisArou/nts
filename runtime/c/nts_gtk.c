/* What a program's GObject classes need of GTK itself, as distinct from
 * GObject: a class built from a template (`static readonly template` and its
 * `declare`d children, `emit/gobject.rs`). Linked only by a program that
 * declares one, so a program using GObject without GTK keeps linking none of
 * it. */
#include <gtk/gtk.h>
#include <stddef.h>
#include <string.h>

/* A template, as GJS's `Template` takes one: `resource:///` names a
 * resource, `file:///` a file, and anything else is the XML. `copy` for text
 * the class does not keep, which the template must outlive; a literal is the
 * program's for as long as it runs. */
static void set_template(void *klass, const char *text, size_t length,
                         gboolean copy) {
  static const char resource[] = "resource:///", file[] = "file:///";
  if (length >= sizeof resource - 1 &&
      memcmp(text, resource, sizeof resource - 1) == 0) {
    char *path =
        g_strndup(text + sizeof resource - 2, length - (sizeof resource - 2));
    gtk_widget_class_set_template_from_resource(GTK_WIDGET_CLASS(klass), path);
    g_free(path);
    return;
  }
  if (length >= sizeof file - 1 && memcmp(text, file, sizeof file - 1) == 0) {
    char *uri = g_strndup(text, length);
    GFile *at = g_file_new_for_uri(uri);
    GError *error = NULL;
    GBytes *bytes = g_file_load_bytes(at, NULL, NULL, &error);
    if (bytes == NULL) {
      g_critical("a template's file %s: %s", uri, error->message);
      g_error_free(error);
    } else {
      gtk_widget_class_set_template(GTK_WIDGET_CLASS(klass), bytes);
      g_bytes_unref(bytes);
    }
    g_object_unref(at);
    g_free(uri);
    return;
  }
  GBytes *bytes =
      copy ? g_bytes_new(text, length) : g_bytes_new_static(text, length);
  gtk_widget_class_set_template(GTK_WIDGET_CLASS(klass), bytes);
  g_bytes_unref(bytes);
}

/* A template the class writes as a literal. */
void nts_gtk_class_template(void *klass, const char *text, size_t length) {
  set_template(klass, text, length, FALSE);
}

/* A template known only at run time, the string the class's reader answers
 * (`{Class}#template`), lent for this call. */
void nts_gtk_class_template_text(void *klass, const char *text) {
  set_template(klass, text, strlen(text), TRUE);
}

/* Each child the class names, bound by its id: no offset, since the program
 * reads a child through `gtk_widget_get_template_child` rather than a struct
 * member (`nts_gtk_template_child`). */
void nts_gtk_class_children(void *klass, const char *const *children,
                            size_t count) {
  for (size_t at = 0; at < count; at++) {
    gtk_widget_class_bind_template_child_full(GTK_WIDGET_CLASS(klass),
                                              children[at], FALSE, 0);
  }
}

/* The template's children, made for one instance. */
void nts_gtk_init_template(void *instance) {
  gtk_widget_init_template(GTK_WIDGET(instance));
}

/* The child `id` of the template `type` declares, borrowed: the template
 * holds it for as long as the widget lives. */
void *nts_gtk_template_child(void *widget, size_t type, const char *id) {
  return gtk_widget_get_template_child(GTK_WIDGET(widget), (GType)type, id);
}

/* A template's signal handler, bound by the name its `<signal handler>`
 * gives: GTK calls it with the signal's arguments and the instance last. */
void nts_gtk_bind_callback(void *klass, const char *name,
                           void (*callback)(void)) {
  gtk_widget_class_bind_template_callback_full(GTK_WIDGET_CLASS(klass), name,
                                               G_CALLBACK(callback));
}
