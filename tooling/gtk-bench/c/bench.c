// The floor: the same cases in C, calling GTK directly with no binding
// between. `run.sh` compiles it with -O2 and reports it beside nts and GJS,
// so each row says how much of its time is GTK's and how much is ours.
#include <gtk/gtk.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static double now(void) { return (double)g_get_monotonic_time() / 1e3; }

static void best(const char *name, long n, void (*run)(long)) {
  run(n);
  double fastest = 1e300;
  for (int rep = 0; rep < 3; rep++) {
    double start = now();
    run(n);
    double took = now() - start;
    if (took < fastest)
      fastest = took;
  }
  printf("%s %.1f\n", name, fastest * 1e6 / (double)n);
}

static long changes;
static double value;
static GtkAdjustment *adjustment;
static void changed(GtkAdjustment *a, gpointer data) {
  (void)a;
  (void)data;
  changes++;
}
static void signal_run(long n) {
  for (long i = 0; i < n; i++)
    gtk_adjustment_set_value(adjustment, ++value);
}

static GtkLabel *label;
static long length;
static void property_run(long n) {
  for (long i = 0; i < n; i++) {
    gtk_label_set_label(label, (i & 1) == 0 ? "a" : "bb");
    length += (long)strlen(gtk_label_get_label(label));
  }
}

static void construct_run(long n) {
  for (long i = 0; i < n; i++) {
    GtkWidget *made = g_object_ref_sink(g_object_new(GTK_TYPE_LABEL, NULL));
    gtk_label_set_label(GTK_LABEL(made), "x");
    if (strlen(gtk_label_get_label(GTK_LABEL(made))) != 1)
      puts("construct: wrong label");
    g_object_unref(made);
  }
}

static GtkWidget *button;
static long visible;
static void method_run(long n) {
  for (long i = 0; i < n; i++)
    if (gtk_widget_get_visible(button))
      visible++;
}

static void mapped(GtkWidget *w, gpointer app) {
  (void)w;
  g_application_quit(G_APPLICATION(app));
}
static void activate(GtkApplication *app, gpointer data) {
  (void)data;
  GtkWidget *window = gtk_window_new();
  gtk_window_set_title(GTK_WINDOW(window), "bench");
  g_signal_connect(window, "map", G_CALLBACK(mapped), app);
  gtk_application_add_window(app, GTK_WINDOW(window));
  gtk_window_present(GTK_WINDOW(window));
}

int main(void) {
  const char *name = getenv("BENCH_CASE");
  if (name == NULL)
    name = "";
  if (strcmp(name, "startup") == 0) {
    GtkApplication *app = gtk_application_new("dev.nts.Bench", G_APPLICATION_NON_UNIQUE);
    g_signal_connect(app, "activate", G_CALLBACK(activate), NULL);
    char *argv[] = {"bench", NULL};
    int status = g_application_run(G_APPLICATION(app), 1, argv);
    g_object_unref(app);
    return status;
  }
  gtk_init();
  if (strcmp(name, "signal") == 0) {
    adjustment = g_object_ref_sink(gtk_adjustment_new(0, 0, 1e12, 0, 0, 0));
    g_signal_connect(adjustment, "value-changed", G_CALLBACK(changed), NULL);
    best("signal", 500000, signal_run);
  } else if (strcmp(name, "property") == 0) {
    label = GTK_LABEL(g_object_ref_sink(gtk_label_new("a")));
    best("property", 500000, property_run);
  } else if (strcmp(name, "construct") == 0) {
    best("construct", 100000, construct_run);
  } else if (strcmp(name, "method") == 0) {
    button = g_object_ref_sink(gtk_button_new_with_label("x"));
    best("method", 2000000, method_run);
  } else {
    printf("unknown case: %s\n", name);
  }
  return 0;
}
