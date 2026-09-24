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
//   thrown        and the same call as a method, with no slot passed, threw an
//                 `Error` carrying the `GError`'s message instead
//   split=a|b|c   `g_strsplit` returned a `char **`, copied into a `string[]`
//                 and released by the binding's `g_strfreev`
//   sha256=ba7816bf  the bytes "abc", from offset 1 of a larger `Uint8Array`,
//                 borrowed in place as `const guint8 *` with their length
//   cast-ok       `asGtkBox` answers the box `gtk_box_new` returned as a widget
//   cast-null     `asGtkLabel` answers null for that same box
//   clicked 1     a typed signal handler, connected through the generated
//                 `gtk_button_connect_clicked`, ran when the signal was emitted,
//                 and was handed the button it was connected to
//   idle          a closure given to `g_idle_add_full` ran
//   label=tick 3  a timeout closure ticked three times, rewriting the label,
//                 which is read back through `gtk_label_get_text`
//   ticks=3       and the count it captured is what `main` reads afterwards
//   kind=2        `g_file_query_info_async` on "/", awaited as a Promise: the
//                 `GAsyncReadyCallback` is a closure C calls once, which the
//                 bridge releases after it, and `_finish` reports through the
//                 `GError **` slot; 2 is `G_FILE_TYPE_DIRECTORY`
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
import {
  gio_application_connect_activate,
  g_application_quit,
  g_application_run,
  g_file_info_get_file_type,
  g_file_new_for_path,
  g_file_query_info_async,
  g_file_query_info_finish,
} from "c:Gio-2.0";
import {
  g_compute_checksum_for_data,
  g_date_time_get_ymd,
  g_date_time_new_utc,
  g_date_time_unref,
  g_error_free,
  g_idle_add_full,
  g_key_file_get_integer,
  g_key_file_load_from_data,
  g_key_file_new,
  g_key_file_unref,
  g_strsplit,
  g_timeout_add_full,
  type GError,
} from "c:GLib-2.0";
import { g_object_unref } from "c:GObject-2.0";
import type { c_double, c_int, c_size_t, c_uint } from "c:types";
import { local } from "c:memory";
import { gir_emit, gir_log } from "c:gir-shim";
import { Orientation, asGtkBox, asGtkButton, asGtkLabel, asGtkWindow } from "../types/gir/Gtk-4.0.values.ts";
import { ChecksumType } from "../types/gir/GLib-2.0.values.ts";
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
  // `@ntsThrows`: leave the slot out, and a failure is thrown.
  try {
    keys.get_integer("a", "absent");
    gir_log("not-thrown");
  } catch (e) {
    gir_log((e as Error).message.length > 0 ? "thrown" : "thrown-empty");
  }
  g_key_file_unref(keys);

  gir_log("split=" + g_strsplit("a,b,c", ",", -1 as c_int).join("|"));

  // `subarray` starts one byte in, so a pointer to the buffer rather than the
  // view would hash "_ab" instead.
  const abc = new Uint8Array([0x5f, 0x61, 0x62, 0x63, 0x5f]).subarray(1, 4);
  const digest = g_compute_checksum_for_data(ChecksumType.SHA256 as c_uint, abc);
  gir_log("sha256=" + (digest === null ? "none" : digest.slice(0, 8)));
}

// GIO's asynchronous shape as a Promise: start, and settle from the one
// callback C makes, reading the result -- or the error -- through `_finish`.
// What M3's generated methods will be, written out once by hand.
function fileKind(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const file = g_file_new_for_path(path);
    file.query_info_async("standard::type", 0 as c_uint, PRIORITY_DEFAULT, null, (_source, result) => {
      const error = local<GError | null>();
      const info = file.query_info_finish(result, error);
      const failure = error[0];
      g_object_unref(file);
      if (failure !== null) {
        g_error_free(failure);
        reject(new Error("query failed"));
        return;
      }
      const kind = info.get_file_type() as number;
      g_object_unref(info);
      resolve(kind);
    });
  });
}

let kind = -1;

async function learnKind(): Promise<void> {
  kind = await fileKind("/");
}

function main(): void {
  outParameters();
  void learnKind();
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
      application.quit();
      return;
    }
    gir_log("cast-ok");
    gir_log(asGtkLabel(box) === null ? "cast-null" : "cast-wrong");
    // Methods on the handles: each is the C function it names, called with
    // the handle as its instance -- `box.append(label)` is
    // `gtk_box_append(box, label)`, and `window.present()` reaches
    // `gtk_window_present` through `GtkApplicationWindow`'s chain.
    box.append(label);
    box.append(button);
    window.set_child(box);
    window.present();
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
      label.set_text("tick " + String(ticks));
      // And the query answered, so the log does not depend on which of the
      // two a loaded machine finishes first.
      if (ticks < 3 || kind === -1) return 1 as c_int;
      gir_log("label=" + label.get_text());
      application.quit();
      return 0 as c_int;
    });
  }, CONNECT_DEFAULT);
  // `argv` as a `string[]`, lent to C as `char **` with `argc` beside it.
  // GApplication parses it, so it holds only the program name: an option it
  // does not know would end the run.
  const status = application.run(["gir"]);
  gir_log("status=" + String(status));
  g_object_unref(application);
  gir_log("ticks=" + String(ticks));
  gir_log("kind=" + String(kind));
}

main();
