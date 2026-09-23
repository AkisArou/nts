// A GTK4 program on generated bindings: nothing of GTK is declared by hand.
// `nts build` reads the GIR files for `c:Gtk-4.0` and the namespaces it
// includes, checks every declaration against the headers, and writes them to
// `types/gir` before this is typechecked.
//
// What it checks, logged for build.sh:
//
//   cast-ok       `asGtkBox` answers the box `gtk_box_new` returned as a widget
//   cast-null     `asGtkLabel` answers null for that same box
//   idle          a closure given to `g_idle_add_full` ran
//   label=tick 3  a timeout closure ticked three times, rewriting the label
//   ticks=3       and the count it captured is what `main` reads afterwards
import {
  gtk_application_new,
  gtk_application_window_new,
  gtk_box_append,
  gtk_box_new,
  gtk_label_get_text,
  gtk_label_new,
  gtk_label_set_text,
  gtk_window_present,
  gtk_window_set_child,
} from "c:Gtk-4.0";
import { g_application_quit } from "c:Gio-2.0";
import { g_idle_add_full, g_timeout_add_full } from "c:GLib-2.0";
import type { c_int, c_uint } from "c:types";
import { gir_connect, gir_log, gir_run, gir_unref } from "c:gir-shim";
import { asGtkBox, asGtkLabel, asGtkWindow } from "../types/gir/Gtk-4.0.values.ts";

// G_PRIORITY_DEFAULT, which GLib defines as a macro rather than an enum.
const PRIORITY_DEFAULT = 0 as c_int;
// `Gio.ApplicationFlags.NON_UNIQUE` and `Gtk.Orientation.VERTICAL`, from the
// generated `.values.ts` modules once a `const enum` read across modules
// lowers; today it is refused as a reverse mapping, which is the language
// lane's to fix. Written as the values GIR records until then.
const NON_UNIQUE = 0x20 as c_uint;
const VERTICAL = 1 as c_uint;

function main(): void {
  const application = gtk_application_new("dev.nts.GtkGir", NON_UNIQUE);
  let ticks = 0;
  gir_connect(application, "activate", () => {
    const window = asGtkWindow(gtk_application_window_new(application));
    const box = asGtkBox(gtk_box_new(VERTICAL, 4 as c_int));
    const label = asGtkLabel(gtk_label_new("start"));
    if (window === null || box === null || label === null) {
      gir_log("cast-failed");
      g_application_quit(application);
      return;
    }
    gir_log("cast-ok");
    gir_log(asGtkLabel(box) === null ? "cast-null" : "cast-wrong");
    gtk_box_append(box, label);
    gtk_window_set_child(window, box);
    gtk_window_present(window);
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
  });
  gir_run(application);
  gir_unref(application);
  gir_log("ticks=" + String(ticks));
}

main();
