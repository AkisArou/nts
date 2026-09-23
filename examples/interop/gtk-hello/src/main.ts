// A GTK4 application that drives itself. `activate` builds a window holding a
// button, clicks the button twice through the signal system, and quits. The
// printed count is what build.sh checks.
import {
  g_application_quit,
  g_application_run,
  gtk_application_new,
  gtk_application_window_new,
  gtk_button_new,
  gtk_window_present,
  gtk_window_set_child,
  hello_as_window,
  hello_click,
  hello_on_activate,
  hello_on_clicked,
  hello_report,
  hello_unref,
  type GtkApplication,
  type GtkWidget,
  type State,
} from "c:gtk-hello";
import type { Ptr, c_int, c_uint } from "c:types";
import { sizeof } from "c:memory";
import { free, malloc } from "c:stdlib";

function onClicked(_button: GtkWidget, state: Ptr<State>): void {
  state.clicks = (state.clicks + 1) as c_int;
}

function onActivate(app: GtkApplication, state: Ptr<State>): void {
  const window = gtk_application_window_new(app);
  const button = gtk_button_new();
  gtk_window_set_child(hello_as_window(window), button);
  hello_on_clicked(button, onClicked, state);
  gtk_window_present(hello_as_window(window));
  hello_click(button);
  hello_click(button);
  g_application_quit(app);
}

// Heap, not `local`: the activate handler is retained by the application, so
// its context has to outlive the call that registered it. Inside a function
// because a module-scope variable cannot hold a native pointer (NTS1001).
function main(): void {
  const state = malloc<State>(sizeof<State>());
  if (state === null) return;
  state.clicks = 0 as c_int;
  // G_APPLICATION_NON_UNIQUE: two runs of this program, the check and its
  // control, must not find each other on the session bus.
  const app = gtk_application_new("dev.nts.GtkHello", 0x20 as c_uint);
  hello_on_activate(app, onActivate, state);
  const status = g_application_run(app, 0 as c_int, null);
  hello_unref(app);
  hello_report(state.clicks as c_int, status);
  free(state);
}

main();
