// A GTK4 application that drives itself. `activate` builds a window holding a
// button, clicks the button twice through the signal system, and quits. The
// printed count is what build.sh checks.
import {
  gtk_application_window_new,
  gtk_button_new,
  gtk_window_present,
  gtk_window_set_child,
  hello_app_new,
  hello_as_window,
  hello_click,
  hello_on_activate,
  hello_on_clicked,
  hello_quit,
  hello_report,
  hello_run,
  hello_unref,
  type GtkApplication,
  type GtkWidget,
  type State,
} from "c:gtk-hello";
import type { Ptr, c_int } from "c:types";
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
  hello_quit(app);
}

// Heap, not `local`: the activate handler is retained by the application, so
// its context has to outlive the call that registered it. Inside a function
// because a module-scope variable cannot hold a native pointer (NTS1001).
function main(): void {
  const state = malloc<State>(sizeof<State>());
  if (state === null) return;
  state.clicks = 0 as c_int;
  const app = hello_app_new();
  hello_on_activate(app, onActivate, state);
  const status = hello_run(app);
  hello_unref(app);
  hello_report(state.clicks as c_int, status);
  free(state);
}

main();
