// A GTK4 application that drives itself. `activate` builds a window holding a
// button, clicks the button twice through the signal system, and quits. The
// printed count is what build.sh checks.
//
// Both handlers are arrows that capture: `activate` captures the application,
// and `clicked` -- connected from inside `activate` -- captures the counter
// that `main` reads back after the loop has finished.
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
  hello_connect,
  hello_report,
  hello_unref,
} from "c:gtk-hello";
import type { c_int, c_uint } from "c:types";

// Inside a function because a module-scope variable cannot hold a native
// pointer (NTS1001).
function main(): void {
  let clicks = 0;
  // G_APPLICATION_NON_UNIQUE: two runs of this program, the check and its
  // control, must not find each other on the session bus.
  const app = gtk_application_new("dev.nts.GtkHello", 0x20 as c_uint);
  hello_connect(app, "activate", () => {
    const window = gtk_application_window_new(app);
    const button = gtk_button_new();
    gtk_window_set_child(hello_as_window(window), button);
    hello_connect(button, "clicked", () => {
      clicks++;
    });
    gtk_window_present(hello_as_window(window));
    hello_click(button);
    hello_click(button);
    g_application_quit(app);
  });
  const status = g_application_run(app, 0 as c_int, null);
  hello_unref(app);
  hello_report(clicks as c_int, status);
}

main();
