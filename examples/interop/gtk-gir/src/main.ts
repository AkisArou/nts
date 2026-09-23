// A GTK4 program on generated bindings: nothing of GTK is declared by hand.
// `nts build` reads the GIR files for `c:Gtk-4.0` and the namespaces it
// includes, checks every declaration against the headers, and writes them to
// `types/gir` before this is typechecked.
//
// What it checks, logged for build.sh:
//
//   ymd=2026-9    `g_date_time_get_ymd` wrote two out parameters on the
//                 stack, and took `null` for the third, which it may skip
//   keyfile 1 5 no-error
//                 a key file loaded and read, and the `GError **` slot beside
//                 each call was left null
//   error-set 0   a missing key wrote a `GError` into that slot, which is freed
//   cast-ok       `asGtkBox` answers the box `gtk_box_new` returned as a widget
//   cast-null     `asGtkLabel` answers null for that same box
//   clicked 1     a typed signal handler, connected through the generated
//                 `gtk_button_connect_clicked`, ran when the signal was emitted,
//                 and was handed the button it was connected to
//   idle          a closure given to `g_idle_add_full` ran
//   label=tick 3  a timeout closure ticked three times, rewriting the label,
//                 which is read back through `gtk_label_get_text`
//   ticks=3       and the count it captured is what `main` reads afterwards
import {
  gtk_application_new,
  gtk_application_window_new,
  gtk_box_append,
  gtk_box_new,
  gtk_button_connect_clicked,
  gtk_button_new_with_label,
  gtk_label_get_text,
  gtk_label_new,
  gtk_label_set_text,
  gtk_window_present,
  gtk_window_set_child,
} from "c:Gtk-4.0";
import { gio_application_connect_activate, g_application_quit, g_application_run } from "c:Gio-2.0";
import {
  g_date_time_get_ymd,
  g_date_time_new_utc,
  g_date_time_unref,
  g_error_free,
  g_idle_add_full,
  g_key_file_get_integer,
  g_key_file_load_from_data,
  g_key_file_new,
  g_key_file_unref,
  g_timeout_add_full,
  type GError,
} from "c:GLib-2.0";
import { g_object_unref } from "c:GObject-2.0";
import type { c_double, c_int, c_size_t, c_uint } from "c:types";
import { local } from "c:memory";
import { gir_emit, gir_log } from "c:gir-shim";
import { Orientation, asGtkBox, asGtkButton, asGtkLabel, asGtkWindow } from "../types/gir/Gtk-4.0.values.ts";
import { ApplicationFlags } from "../types/gir/Gio-2.0.values.ts";

// G_PRIORITY_DEFAULT, which GLib defines as a macro rather than an enum.
const PRIORITY_DEFAULT = 0 as c_int;
// No `G_CONNECT_*` flags.
const CONNECT_DEFAULT = 0 as c_uint;

// Out parameters, `GError **` among them: slots on this function's stack that
// C writes through during the call, read once it returns.
function outParameters(): void {
  const when = g_date_time_new_utc(2026 as c_int, 9 as c_int, 24 as c_int, 0 as c_int, 0 as c_int, 0 as c_double);
  if (when === null) {
    gir_log("no-date");
    return;
  }
  const year = local<c_int>();
  const month = local<c_int>();
  g_date_time_get_ymd(when, year, month, null);
  gir_log("ymd=" + String(year[0]) + "-" + String(month[0]));
  g_date_time_unref(when);

  const keys = g_key_file_new();
  const error = local<GError | null>();
  const text = "[a]\nk=5\n";
  const loaded = g_key_file_load_from_data(keys, text, BigInt(text.length) as c_size_t, 0 as c_uint, error);
  const k = g_key_file_get_integer(keys, "a", "k", error);
  gir_log("keyfile " + String(loaded) + " " + String(k) + " " + (error[0] === null ? "no-error" : "error"));
  const missing = g_key_file_get_integer(keys, "a", "absent", error);
  const failure = error[0];
  if (failure !== null) {
    gir_log("error-set " + String(missing));
    g_error_free(failure);
    error[0] = null;
  }
  g_key_file_unref(keys);
}

function main(): void {
  outParameters();
  const application = gtk_application_new("dev.nts.GtkGir", ApplicationFlags.NON_UNIQUE as c_uint);
  let ticks = 0;
  let clicks = 0;
  gio_application_connect_activate(application, "activate", () => {
    const window = asGtkWindow(gtk_application_window_new(application));
    const box = asGtkBox(gtk_box_new(Orientation.VERTICAL as c_uint, 4 as c_int));
    const label = asGtkLabel(gtk_label_new("start"));
    const button = asGtkButton(gtk_button_new_with_label("press"));
    if (window === null || box === null || label === null || button === null) {
      gir_log("cast-failed");
      g_application_quit(application);
      return;
    }
    gir_log("cast-ok");
    gir_log(asGtkLabel(box) === null ? "cast-null" : "cast-wrong");
    gtk_box_append(box, label);
    gtk_box_append(box, button);
    gtk_window_set_child(window, box);
    gtk_window_present(window);
    gtk_button_connect_clicked(button, "clicked", (self) => {
      clicks++;
      gir_log(asGtkButton(self) === null ? "clicked-not-a-button" : "clicked " + String(clicks));
    }, CONNECT_DEFAULT);
    gir_emit(button, "clicked");
    g_idle_add_full(PRIORITY_DEFAULT, () => {
      gir_log("idle");
      return 0 as c_int;
    });
    g_timeout_add_full(PRIORITY_DEFAULT, 10 as c_uint, () => {
      ticks++;
      gtk_label_set_text(label, "tick " + String(ticks));
      if (ticks < 3) return 1 as c_int;
      gir_log("label=" + gtk_label_get_text(label));
      g_application_quit(application);
      return 0 as c_int;
    });
  }, CONNECT_DEFAULT);
  // `argv` as a `string[]`, lent to C as `char **` with `argc` beside it.
  // GApplication parses it, so it holds only the program name: an option it
  // does not know would end the run.
  const status = g_application_run(application, ["gir"]);
  gir_log("status=" + String(status));
  g_object_unref(application);
  gir_log("ticks=" + String(ticks));
}

main();
