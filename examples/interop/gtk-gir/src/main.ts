// A GTK4 program on generated bindings: nothing of GTK is declared by hand.
// `nts build` reads the GIR files for `c:Gtk-4.0` and the namespaces it
// includes, checks every declaration against the headers, and writes them to
// `types/gir` before this is typechecked.
//
// What it checks, logged for build.sh:
//
//   ymd=2026-9    `g_date_time_get_ymd` wrote two out parameters on the
//                 stack, and took `null` for the third, which it may skip
//   values=2026/9/24  `when.get_ymd()` with no slots: all three returned, as
//                 GJS returns out parameters, through a generated wrapper
//   markup=bold x|none  `pango_parse_markup`'s text out parameter, a
//                 `char *` read with `stringFrom` and freed; `null` is `null`
//   iter hello world|orld 7 6 11  boxed records: `new GtkTextIter()` filled by
//                 `get_bounds`, moved in place by `forward_chars` through another
//                 name for it, and `copy()`, a record of its own the next move
//                 leaves behind
//   rgba true rgb(255,128,0)  a `GdkRGBA` the program made, filled by `parse`
//   font Sans     a record a function hands over, set on a context, and the
//                 one the context's getter lends back, copied into a box
//   lists 0 0 2   `null` for a lent `CStrings | null`, as NULL: to
//                 `gtk_string_list_new` directly and through `{ strings }`
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
//   entry typed! 0  `GtkEditable`'s `set_text`, `get_text` and `text` on a
//                 `GtkEntry`, and `GtkOrientable`'s orientation on a `GtkBox`:
//                 an interface's methods on the classes implementing it
//   bounds true 1 3  `entry.get_selection_bounds()`: the `gboolean` result,
//                 then the two out values
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
//   made=true again=rejected removed=true contents=6
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
  GtkTextBuffer,
  GtkTextIter,
  gtk_button_get_type,
  GtkEntry,
  GtkEntryBuffer,
  GtkLabel,
  GtkStringList,
  gtk_string_list_new,
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
  g_free,
  g_key_file_load_from_data,
  g_key_file_new,
  g_key_file_unref,
  g_strsplit,
  g_timeout_add_full,
  ChecksumType,
  KeyFileFlags,
  type GError,
} from "c:GLib-2.0";
import { g_signal_group_new } from "c:GObject-2.0";
import { GdkRGBA } from "c:Gdk-4.0";
import { pango_context_new, pango_font_description_from_string, pango_parse_markup } from "c:Pango-1.0";
import type { CNumber, Ptr, c_char } from "c:types";
import { local, stringFrom } from "c:memory";
import { gir_emit, gir_log } from "c:gir-shim";
import { asGtkBox, asGtkButton, asGtkLabel } from "../types/gir/Gtk-4.0.values.ts";

// G_PRIORITY_DEFAULT, which GLib defines as a macro rather than an enum.
const PRIORITY_DEFAULT = 0;

// Out parameters, `GError **` among them: slots on this function's stack that
// C writes through during the call, read once it returns.
// GLib boxed records, held by reference as GJS holds them: a `GtkTextIter`
// the program makes and C fills, moved in place by a method, copied into one
// of its own, and a record a getter only lends, copied into a box.
function boxedRecords(): void {
  const buffer = new GtkTextBuffer({});
  buffer.set_text("hello world", -1);
  const start = new GtkTextIter();
  const end = new GtkTextIter();
  buffer.get_bounds(start, end);
  const all = buffer.get_text(start, end, false);
  const moved = start;
  moved.forward_chars(6);
  const copy = start.copy();
  start.forward_char();
  // `buffer` named again after its iterators' last use: an iterator points
  // into its buffer without counting it, and under `--rc` a buffer released
  // at its last use is gone before the offsets are read (docs/gtk-lane-goal.md).
  gir_log(
    "iter " + all + "|" + buffer.get_text(start, end, false) + " " + String(start.get_offset()) + " " + String(copy.get_offset()) + " " + String(buffer.get_char_count()),
  );
  // GJS's shape for storage the caller allocates: made and returned.
  const [first, last] = buffer.get_bounds();
  gir_log("bounds " + String(first.get_offset()) + "-" + String(last.get_offset()) + " " + String(buffer.get_char_count()));
  const rgba = new GdkRGBA();
  const parsed = rgba.parse("#ff8000");
  gir_log("rgba " + String(parsed) + " " + rgba.to_string());
  // One handed over, and one a getter lends back, which the program copies.
  const given = pango_font_description_from_string("Sans 12");
  const context = pango_context_new();
  context.set_font_description(given);
  const lent = context.get_font_description();
  gir_log("font " + (lent === null ? "none" : lent.get_family() ?? "none"));
}

function outParameters(): void {
  const when = g_date_time_new_utc(2026, 9, 24, 0, 0, 0);
  if (when === null) {
    gir_log("no-date");
    return;
  }
  const year = local<CNumber<"int">>();
  const month = local<CNumber<"int">>();
  g_date_time_get_ymd(when, year, month, null);
  gir_log("ymd=" + String(year[0]) + "-" + String(month[0]));
  // The same as GJS has it: the out values returned, in order.
  const [y, m, d] = when.get_ymd();
  gir_log("values=" + String(y) + "/" + String(m) + "/" + String(d));
  g_date_time_unref(when);

  // A string out of a slot: `char *` C wrote there, read by `stringFrom`
  // (copied; the pointer is still C's to free), and a NULL read as `null`.
  const stripped = local<Ptr<c_char>>();
  pango_parse_markup("<b>bold</b> x", -1, 0, null, stripped);
  const markup = stringFrom(stripped[0]);
  g_free(stripped[0]);
  gir_log("markup=" + (markup ?? "none") + "|" + (stringFrom(null) ?? "none"));

  const keys = g_key_file_new();
  const error = local<GError | null>();
  const text = "[a]\nk=5\n";
  const loaded = g_key_file_load_from_data(keys, text, text.length, KeyFileFlags.NONE, error);
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

  gir_log("split=" + g_strsplit("a,b,c", ",", -1).join("|"));

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
  // A file written and read back: `replace_contents_async` is lent bytes
  // that GIO writes from a pool thread after the call returns, and that its
  // Promise form keeps until `_finish` runs. `load_bytes_async`'s `_finish`
  // leaves out its optional `etag_out`, as GJS does.
  const file = g_file_new_for_path(path + ".txt");
  // "héllo" in UTF-8.
  await file.replace_contents_async(new Uint8Array([104, 195, 169, 108, 108, 111]), null, false);
  const bytes = await file.load_bytes_async();
  await file.delete_async();
  folders = "made=" + String(made) + " again=" + again + " removed=" + String(removed) + " contents=" + String(bytes.get_size());
}

let folders = "";

let kind = -1;

async function learnKind(): Promise<void> {
  kind = await fileKind("/");
}

// `null` for a lent array that admits it -- `CStrings | null` -- which C is
// passed as NULL, called directly and through a construct property.
function absentArrays(): void {
  const direct = gtk_string_list_new(null);
  const constructed = new GtkStringList({ strings: null });
  const given = new GtkStringList({ strings: ["a", "b"] });
  gir_log("lists " + String(direct.get_n_items()) + " " + String(constructed.get_n_items()) + " " + String(given.get_n_items()));
}

function main(): void {
  outParameters();
  boxedRecords();
  absentArrays();
  void learnKind();
  void directories("/tmp/nts-gtk-gir-directory");
  const application = gtk_application_new("dev.nts.GtkGir", ApplicationFlags.NON_UNIQUE);
  let ticks = 0;
  let clicks = 0;
  application.connect("activate", () => {
    // Each constructor returns its class, as GIR declares it -- a `GtkBox`
    // from `gtk_box_new`, which C declares `GtkWidget *`.
    const window = gtk_application_window_new(application);
    const box = gtk_box_new(Orientation.VERTICAL, 4);
    // No `new` of its own taking nothing: made by its `GType`, as GJS does.
    const label = new GtkLabel({ label: "start", selectable: true });
    // GJS's construction: `gtk_button_new`, then the setter of each
    // property the literal writes, in its order.
    const button = new GtkButton({ label: "press", has_frame: false });
    gir_log("made " + String(button.label) + " " + String(button.has_frame));
    // A `gpointer` result the caller owns that is a GObject
    // (`Owned<Erased<GObject>>`): adopted rather than referenced again, and
    // released once -- `fatal-criticals` under `--rc` would abort on a count
    // taken from a reference nobody gave.
    const group = g_signal_group_new(gtk_button_get_type());
    group.set_target(button);
    const target = group.dup_target();
    gir_log("dup-target " + String(target === button));
    // Not floating: the program's own reference, which `--rc` releases once.
    const buffer = new GtkEntryBuffer({ max_length: 2 });
    buffer.set_text("abc", -1);
    gir_log("buffer " + buffer.text + " " + String(label.selectable));
    // An interface's methods and properties on a class implementing it, as
    // GJS has them: `GtkEditable`'s on a `GtkEntry`, `GtkOrientable`'s on a
    // `GtkBox` -- each the C function taking the interface.
    const entry = new GtkEntry({});
    entry.set_text("typed");
    entry.text = entry.get_text() + "!";
    box.set_orientation(Orientation.HORIZONTAL);
    gir_log("entry " + entry.text + " " + String(box.get_orientation()));
    // The function's own result first, then its out values.
    entry.select_region(1, 3);
    const [selected, start, end] = entry.get_selection_bounds();
    gir_log("bounds " + String(selected) + " " + String(start) + " " + String(end));
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
    g_timeout_add_full(PRIORITY_DEFAULT, 10, () => {
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
