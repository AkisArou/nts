/* What a program's GObject classes need of GTK itself, as distinct from
 * GObject: a class built from a template (`static readonly template` and its
 * `declare`d children, `emit/gobject.rs`). Linked only by a program that
 * declares one, so a program using GObject without GTK keeps linking none of
 * it. */
#include <gtk/gtk.h>
#include <stddef.h>

/* The template, and each child the class names, bound by its id: no offset,
 * since the program reads a child through `gtk_widget_get_template_child`
 * rather than a struct member (`nts_gtk_template_child`). */
void nts_gtk_class_template(void *klass, const char *xml, size_t length,
                            const char *const *children, size_t count) {
  GBytes *bytes = g_bytes_new_static(xml, length);
  gtk_widget_class_set_template(GTK_WIDGET_CLASS(klass), bytes);
  g_bytes_unref(bytes);
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
