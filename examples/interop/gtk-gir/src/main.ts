// A GTK4 program on generated bindings: nothing of GTK is declared by hand.
// `nts build` reads the GIR files for `c:Gtk-4.0` and the namespaces it
// includes, checks every declaration against the headers, and writes them to
// `types/gir` before this is typechecked.
//
// What it checks, logged for build.sh:
//
//   ymd=2026-9    `g_date_time_get_ymd` wrote two out parameters on the
//                 stack, and took `null` for the third, which it may skip
//   keyfile true 5 no-error
//                 a key file loaded -- its `gboolean` answer a boolean -- and
//                 read, and the `GError **` slot beside each call left null
//   error-set 0   a missing key wrote a `GError` into that slot, which is freed
//   thrown        and the same call as a method, with no slot passed, threw an
//                 `Error` carrying the `GError`'s message instead
//   split=a|b|c   `g_strsplit` returned a `char **`, copied into a `string[]`
//                 and released by the binding's `g_strfreev`
//   sha256=ba7816bf  the bytes "abc", from offset 1 of a larger `Uint8Array`,
//                 borrowed in place as `const guint8 *` with their length
//   made press false  `new GtkButton({ label: "press", has_frame: false })`:
//                 `gtk_button_new`, then each setter the literal writes -- a
//                 frame is on by default, so `false` is the setter's doing
//   cast-ok       `asGtkBox` answers the box `gtk_box_new` returned, held as
//                 a plain `GtkWidget`
//   cast-null     `asGtkLabel` answers null for that same widget
//   clicked 1     a typed signal handler, connected as GJS spells it --
//                 `button.connect("clicked", handler)`, the flags left out --
//                 ran when the signal was emitted, and was handed the button
//                 it was connected to
//   order=ab      `connect_after` passes `G_CONNECT_AFTER`: its handler,
//                 connected first, still ran after the plain one
//   idle          a closure given to `g_idle_add_full` ran
//   label=tick 3  a timeout closure ticked three times, rewriting the label
//                 through its `label` property, as GJS writes it -- the
//                 `gtk_label_set_label` and `gtk_label_get_label` GIR names
//   ticks=3       and the count it captured is what `main` reads afterwards
//   made=true again=rejected removed=true
//                 `make_directory_async` and `delete_async` awaited: the
//                 Promise forms the binding generates, resolving with what
//                 `_finish` returns and rejecting with the `GError` it reports,
//                 their priority and cancellable left out
//   kind=2        `g_file_query_info_async` on "/", awaited as a Promise: the
//                 `GAsyncReadyCallback` is a closure C calls once, which the
//                 bridge releases after it, and `_finish` reports through the
//                 `GError **` slot; 2 is `G_FILE_TYPE_DIRECTORY`
import {
  gtk_application_new,
  gtk_application_window_new,
  gtk_box_append,
  gtk_box_new,
  gtk_window_present,
  gtk_window_set_child,
  Orientation,
  GtkButton,
  GtkEntryBuffer,
  GtkLabel,
  type GtkWidget,
} from "c:Gtk-4.0";
import {
  ApplicationFlags,
  FileType,
  g_application_quit,
  g_application_run,
  g_file_new_for_path,
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
  ChecksumType,
  KeyFileFlags,
  type GError,
} from "c:GLib-2.0";
import type { c_double, c_int, c_size_t, c_uint } from "c:types";
import { local } from "c:memory";
import { gir_emit, gir_log } from "c:gir-shim";
import { asGtkBox, asGtkButton, asGtkLabel } from "../types/gir/Gtk-4.0.values.ts";

// G_PRIORITY_DEFAULT, which GLib defines as a macro rather than an enum.
const PRIORITY_DEFAULT = 0 as c_int;

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
  const loaded = g_key_file_load_from_data(keys, text, BigInt(text.length) as c_size_t, KeyFileFlags.NONE, error);
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
  // An enum member as it is: the parameter is `CEnum<GChecksumType, c_uint>`.
  const digest = g_compute_checksum_for_data(ChecksumType.SHA256, abc);
  gir_log("sha256=" + (digest === null ? "none" : digest.slice(0, 8)));
}

// A handle, awaited: `query_info_async`'s `_finish` returns a `GFileInfo *`,
// which the promise carries in a slot of its own -- a C pointer is not a
// value the collector may read.
async function fileKind(path: string): Promise<number> {
  const file = g_file_new_for_path(path);
  // No flags, the default priority, nothing to cancel it: left out.
  const info = await file.query_info_async("standard::type");
  const found = info.get_file_type();
  return found === FileType.DIRECTORY ? 2 : found;
}

// GIO's asynchronous methods, awaited: without its callback an `_async`
// method is the Promise form the binding generates from it and its
// `_finish`, which settles with what `_finish` returns -- or rejects with the
// `GError` it reports.
async function directories(path: string): Promise<void> {
  const directory = g_file_new_for_path(path);
  try {
    await directory.delete_async();
  } catch {
    // Absent already, which is the usual case.
  }
  const made = await directory.make_directory_async();
  let again = "resolved";
  try {
    await directory.make_directory_async();
  } catch (e) {
    again = (e as Error).message.length > 0 ? "rejected" : "rejected-empty";
  }
  const removed = await directory.delete_async();
  folders = "made=" + String(made) + " again=" + again + " removed=" + String(removed);
}

let folders = "";

let kind = -1;

async function learnKind(): Promise<void> {
  kind = await fileKind("/");
}

function main(): void {
  outParameters();
  void learnKind();
  void directories("/tmp/nts-gtk-gir-directory");
  const application = gtk_application_new("dev.nts.GtkGir", ApplicationFlags.NON_UNIQUE);
  let ticks = 0;
  let clicks = 0;
  application.connect("activate", () => {
    // Each constructor returns its class, as GIR declares it -- a `GtkBox`
    // from `gtk_box_new`, which C declares `GtkWidget *`.
    const window = gtk_application_window_new(application);
    const box = gtk_box_new(Orientation.VERTICAL, 4 as c_int);
    // No `new` of its own taking nothing: made by its `GType`, as GJS does.
    const label = new GtkLabel({ label: "start", selectable: true });
    // GJS's construction: `gtk_button_new`, then the setter of each
    // property the literal writes, in its order.
    const button = new GtkButton({ label: "press", has_frame: false });
    gir_log("made " + String(button.label) + " " + String(button.has_frame));
    // Not floating: the program's own reference, which `--rc` releases once.
    const buffer = new GtkEntryBuffer({ max_length: 2 as c_int });
    buffer.set_text("abc", -1 as c_int);
    gir_log("buffer " + buffer.text + " " + String(label.selectable));
    // A checked downcast, for a handle known only as a widget.
    const widget: GtkWidget = box;
    gir_log(asGtkBox(widget) === null ? "cast-failed" : "cast-ok");
    gir_log(asGtkLabel(widget) === null ? "cast-null" : "cast-wrong");
    // Methods on the handles: each is the C function it names, called with
    // the handle as its instance -- `box.append(label)` is
    // `gtk_box_append(box, label)`, and `window.present()` reaches
    // `gtk_window_present` through `GtkApplicationWindow`'s chain.
    box.append(label);
    box.append(button);
    window.set_child(box);
    window.present();
    let order = "";
    button.connect_after("clicked", () => {
      order += "b";
    });
    button.connect("clicked", (self) => {
      clicks++;
      order += "a";
      gir_log(asGtkButton(self) === null ? "clicked-not-a-button" : "clicked " + String(clicks));
    });
    gir_emit(button, "clicked");
    gir_log("order=" + order);
    // A `GSourceFunc` answers a `gboolean`, as GJS writes it: `false`
    // removes the source, `true` keeps it.
    g_idle_add_full(PRIORITY_DEFAULT, () => {
      gir_log("idle");
      return false;
    });
    g_timeout_add_full(PRIORITY_DEFAULT, 10 as c_uint, () => {
      ticks++;
      label.label = "tick " + String(ticks);
      // And the query answered, so the log does not depend on which of the
      // two a loaded machine finishes first.
      if (ticks < 3 || kind === -1 || folders === "") return true;
      gir_log("label=" + label.label);
      application.quit();
      return false;
    });
  });
  // `argv` as a `string[]`, lent to C as `char **` with `argc` beside it.
  // GApplication parses it, so it holds only the program name: an option it
  // does not know would end the run.
  const status = application.run(["gir"]);
  gir_log("status=" + String(status));
  gir_log("ticks=" + String(ticks));
  gir_log("kind=" + String(kind));
  gir_log(folders);
}

main();
