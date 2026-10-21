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
//   erased bytes=true hash=true rgba=true parent=true  records C takes as
//                 `gconstpointer` -- two `GBytes`, two `GdkRGBA`, compared as
//                 `const void *` -- and `GtkButton`'s class struct, which C
//                 answers and takes as `gpointer`: referenced, its parent's
//                 peeked, released
//   hb en-us true  HarfBuzz's `hb_language_t`, a pointer record -- itself a
//                 `const struct hb_language_impl_t *` -- held as its handle:
//                 "en-US" read back as HarfBuzz writes it, a more specific "en"
//   reach access=0 ot=en backend=true print=true net still=true  what GIR
//                 describes and its headers do not include: by the GTK
//                 platform's bind request, g_access (glib/gstdio.h), the
//                 language OpenType tags `ENG ` (hb-ot.h), the unix print
//                 dialog's type and g_networking_init (gnetworking.h); by
//                 nts.config.ts's `girExtras`, what a library keeps for its
//                 implementers behind a macro -- a null settings backend
//                 (gsettingsbackend.h) and a GdkPixbuf animation of the
//                 program's, whose `is_static_image` slot the class struct
//                 places only under GDK_PIXBUF_ENABLE_BACKEND
//   collected 1 true aat 0  a set the program made, which HarfBuzz fills: GIR's
//                 caller-allocated `out` of a record the headers keep opaque
//                 is the caller's own object. The face is built from two
//                 tables, a `cmap` mapping U+0041 to glyph 1 and a `maxp` of
//                 two glyphs, so the set holds exactly U+0041
//   rect 1,2 3x4  a `PangoRectangle` the program lays out itself -- a record
//                 with no GType, a `Struct` -- written in Pango units, which
//                 `pango_extents_to_pixels` rewrites in place: the origin
//                 rounded down, the far edge up
//   path true 10 false  a `GskPathPoint` in the program's own box, which GTK
//                 rewrites in place: GIR does not say the caller allocates it,
//                 and the header's `GskPathPoint *` does -- moved from the
//                 start of `M 0 0 L 10 0` to its end, 10 from the origin, and
//                 at the end no further
//   query GtkButton  a `GTypeQuery` the program lays out, which GObject fills:
//                 its `type_name` member a `const char *` the program reads with
//                 `stringFrom`, owning nothing
//   store true true  a `GType` property, crossing as the `gsize` C holds it
//                 in: a list store's `item-type`, given at construction, read
//                 back by its method and as its property, `g_object_get`'s
//   pid true      a C typedef Gio names as a type of its own, `pid_t`: the
//                 integer the headers make it, this process's id
//   refcount 2 true flags 1  pointers GIR leaves unannotated, which the binding
//                 spells as the header writes them: a `gatomicrefcount *` in
//                 storage the program allocates, set to 1 and raised to 2 by
//                 GLib; and a `GData **`, an empty datalist the program
//                 allocates, given a flag and asked for it back
//   quark nts     an alias GLib declares, named as its C documentation names
//                 it: a `GQuark`, the `Uint32` a string is interned as, and
//                 the string it is the quark of
//   parsed 7 tail  a `const gchar **` GIR does not call out, the raw pointer
//                 the header writes: where g_variant_parse stopped in "7 tail",
//                 in storage the program allocates, read back as text
//   font Sans     a record a function hands over, set on a context, and the
//                 one the context's getter lends back, copied into a box
//   lists 0 0 2   `null` for a lent `CStrings | null`, as NULL: to
//                 `gtk_string_list_new` directly and through `{ strings }`
//   group Desktop Entry  a string GLib `#define`s, G_KEY_FILE_DESKTOP_GROUP:
//                 declared as its literal type, and read as the text it is
//   keyfile true 5 no-error
//                 a key file loaded -- its `gboolean` answer a boolean -- and
//                 read, and the `GError **` slot beside each call left null
//   copied x|y|z 1,2,3 argv a|b c  arrays C hands back with their length in
//                 a slot, copied and freed as their transfer says: a key
//                 file's string list by the method's values form, its integer
//                 list by the free function's, and `g_shell_parse_argv`'s
//                 `argv`, an array C writes into an out slot
//   folded hello|wörld world spawned 97,98  arrays C hands back ended by a
//                 zero, counted to it and copied: the ASCII alternates
//                 `g_str_tokenize_and_fold` writes into an out slot, and the
//                 bytes a process wrote, which `g_spawn_command_line_sync`
//                 collects
//   error-set 0   a missing key wrote a `GError` into that slot, which is freed
//   thrown        and the same call as a method, with no slot passed, threw an
//                 `Error` carrying the `GError`'s message instead
//   split=a|b|c   `g_strsplit` returned a `char **`, copied into a `string[]`
//                 and released by the binding's `g_strfreev`
//   sha256=ba7816bf  the bytes "abc", from offset 1 of a larger `Uint8Array`,
//                 borrowed in place as `const guint8 *` with their length
//   write 3 abc   the same bytes lent as the `const void *` the header
//                 declares (GIR writes `void*`) to `g_output_stream_write`,
//                 read back from its memory stream
//   vfunc flushed=true count=2 thrown=flushed once  `Flusher`'s TypeScript
//                 `flush`, a virtual function reporting through `GError **`,
//                 which GIO calls from `g_output_stream_flush`: answered once,
//                 then refused through its `error` slot and thrown at the caller
//   made press false  `new GtkButton({ label: "press", has_frame: false })`:
//                 `gtk_button_new`, then each setter the literal writes -- a
//                 frame is on by default, so `false` is the setter's doing
//   run true      a record known by its alias: a `PangoLayoutRun`, the
//                 `PangoGlyphItem` the iterator of the button's layout lends
//   compound 6    `label.width_chars |= 4` and `^= 0`: a property read through
//                 its getter and written through its setter, one receiver
//   themed 6 document-open-recent  `new GThemedIcon({ name, use_default_fallbacks })`:
//                 construct-only properties, given to `g_object_new` since no
//                 setter writes them -- the name, and its five fallbacks
//   entry typed! 0  `GtkEditable`'s `set_text`, `get_text` and `text` on a
//                 `GtkEntry`, and `GtkOrientable`'s orientation on a `GtkBox`:
//                 an interface's methods on the classes implementing it
//   bounds true 1 3  `entry.get_selection_bounds()`: the `gboolean` result,
//                 then the two out values
//   cast-ok       `instanceof GtkBox` is true of the box `gtk_box_new`
//                 returned, held as a plain `GtkWidget` -- its `GType`, asked
//   cast-null     `instanceof GtkLabel` is false of that same widget
//   clicked 1     a typed signal handler, connected as GJS spells it --
//                 `button.connect("clicked", handler)`, the flags left out --
//                 ran when the signal was emitted, and was handed the button
//                 it was connected to
//   order=ab      `connect_after` passes `G_CONNECT_AFTER`: its handler,
//                 connected first, still ran after the plain one
//   idle          a closure given to `g_idle_add_full` ran
//   label=tick 3  a timeout closure ticked three times, rewriting the label
//   allocation laid  a `GtkAllocation`, which is a `GdkRectangle`: the
//                 program's box, which GTK fills with the button's allocation
//                 once the window is laid out -- the run waits for it
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
//   sorted=banana|apple|kiwi  a closure expression, GJS's
//                 `new Gtk.ClosureExpression(GObject.TYPE_STRING, fn, null)`,
//                 as a string sorter's key: each word by its last letter. The
//                 function's string is C's to free -- GLib's marshaller takes it
//                 over -- so the bridge answers a copy, under `--rc` too
import {
  gtk_application_new,
  gtk_application_window_new,
  gtk_box_append,
  gtk_box_new,
  gtk_cclosure_expression_new,
  GtkSortListModel,
  GtkStringObject,
  GtkStringSorter,
  gtk_widget_create_pango_layout,
  gtk_widget_get_allocation,
  gtk_window_present,
  gtk_window_set_child,
  Orientation,
  GtkButton,
  GtkTextBuffer,
  GtkTextIter,
  gtk_button_get_type,
  gtk_print_unix_dialog_get_type,
  GtkEntry,
  GtkEntryBuffer,
  GtkLabel,
  GtkStringList,
  gtk_string_list_new,
  type GtkWidget,
  GtkBox,
} from "c:Gtk-4.0";
import {
  ApplicationFlags,
  FileType,
  g_application_quit,
  g_application_run,
  g_file_new_for_path,
  g_memory_output_stream_new_resizable,
  g_memory_output_stream_steal_as_bytes,
  g_io_error_quark,
  g_networking_init,
  g_null_settings_backend_new,
  g_output_stream_close,
  g_output_stream_flush,
  g_output_stream_write,
  GOutputStream,
  GListStore,
  g_credentials_new,
  GThemedIcon,
  IOErrorEnum,
  type GCancellable,
} from "c:Gio-2.0";
import {
  g_compute_checksum_for_data,
  g_date_time_get_ymd,
  g_date_time_new_utc,
  g_date_time_unref,
  g_error_free,
  g_idle_add_full,
  g_key_file_get_integer,
  g_key_file_get_integer_list,
  g_shell_parse_argv,
  g_spawn_command_line_sync,
  g_str_tokenize_and_fold,
  g_free,
  g_malloc0,
  g_memdup2,
  g_key_file_load_from_data,
  g_key_file_new,
  g_key_file_unref,
  g_quark_from_string,
  g_quark_to_string,
  g_variant_parse,
  G_KEY_FILE_DESKTOP_GROUP,
  g_access,
  g_atomic_ref_count_compare,
  g_atomic_ref_count_inc,
  g_atomic_ref_count_init,
  g_set_error_literal,
  g_strsplit,
  g_timeout_add_full,
  ChecksumType,
  KeyFileFlags,
  type GError,
  g_bytes_new,
  g_datalist_get_flags,
  g_datalist_set_flags,
  g_bytes_equal,
  g_bytes_hash,
} from "c:GLib-2.0";
import type { GData, GQuark } from "c:GLib-2.0";
import {
  G_TYPE_STRING,
  g_signal_group_new,
  g_object_set_data,
  g_object_get_data,
  g_type_class_peek_parent,
  g_type_class_ref,
  g_type_query,
  g_type_class_unref,
} from "c:GObject-2.0";
import type { GTypeQuery } from "c:GObject-2.0";
import { GdkRGBA, GdkRectangle, gdk_rgba_equal } from "c:Gdk-4.0";
import { GdkPixbufAnimation, gdk_pixbuf_animation_is_static_image } from "c:GdkPixbuf-2.0";
import { graphene_point_distance, graphene_point_t, graphene_point_zero } from "c:Graphene-1.0";
import {
  GskPathPoint,
  gsk_path_get_next,
  gsk_path_get_start_point,
  gsk_path_parse,
  gsk_path_point_get_position,
} from "c:Gsk-4.0";
import {
  hb_face_builder_add_table,
  hb_face_builder_create,
  hb_face_collect_unicodes,
  hb_aat_layout_has_substitution,
  hb_glib_blob_create,
  hb_language_from_string,
  hb_language_matches,
  hb_language_to_string,
  hb_ot_tag_to_language,
  hb_set_create,
  hb_set_get_population,
  hb_set_has,
} from "c:HarfBuzz-0.0";
import {
  pango_context_new,
  pango_extents_to_pixels,
  pango_font_description_from_string,
  pango_layout_get_iter,
  pango_layout_iter_get_run,
  pango_parse_markup,
} from "c:Pango-1.0";
import type { PangoRectangle } from "c:Pango-1.0";
import type { CBool, ConstPtr, Ptr } from "c:types";
import type { c_int, c_char } from "@nts/scalars";
import { local, sizeof, stringFrom, bytesFrom } from "c:memory";
import { free, malloc } from "c:stdlib";

// G_PRIORITY_DEFAULT, which GLib defines as a macro rather than an enum.
const PRIORITY_DEFAULT = 0;

// A `GOutputStream` whose `flush` is TypeScript, a virtual function that
// reports through `GError **`, reached through `g_output_stream_flush`: the
// first flush is answered, the second refused through the override's `error`
// slot, which the caller -- passing no slot of its own -- sees thrown.
// An animation that is one still image, which GdkPixbuf asks through its
// class struct's slot.
class StillImage extends GdkPixbufAnimation {
  vfunc_is_static_image(): CBool<c_int> {
    return true;
  }
}

class Flusher extends GOutputStream {
  flushes = 0;

  vfunc_flush(cancellable?: GCancellable | null, error?: Ptr<GError | null> | null): CBool<c_int> {
    this.flushes++;
    if (this.flushes === 1) return true;
    g_set_error_literal(error ?? null, g_io_error_quark(), IOErrorEnum.FAILED, "flushed once");
    return false;
  }
}

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
  console.log(
    "iter " + all + "|" + buffer.get_text(start, end, false) + " " + String(start.get_offset()) + " " + String(copy.get_offset()) + " " + String(buffer.get_char_count()),
  );
  // GJS's shape for storage the caller allocates: made and returned.
  const [first, last] = buffer.get_bounds();
  console.log("bounds " + String(first.get_offset()) + "-" + String(last.get_offset()) + " " + String(buffer.get_char_count()));
  const rgba = new GdkRGBA();
  const parsed = rgba.parse("#ff8000");
  console.log("rgba " + String(parsed) + " " + rgba.to_string());
  // Records C takes or answers as `gconstpointer` or `gpointer`, erased:
  // two `GBytes` and two `GdkRGBA` compared as `const void *`, and a class
  // struct referenced, its parent's peeked, and released.
  const same = new GdkRGBA();
  same.parse("#ff8000");
  const left = g_bytes_new(new Uint8Array([1, 2]));
  const right = g_bytes_new(new Uint8Array([1, 2]));
  const buttonClass = g_type_class_ref(gtk_button_get_type());
  const parentClass = g_type_class_peek_parent(buttonClass);
  g_type_class_unref(buttonClass);
  console.log(
    "erased bytes=" + String(g_bytes_equal(left, right)) + " hash=" + String(g_bytes_hash(left) === g_bytes_hash(right)) +
      " rgba=" + String(gdk_rgba_equal(rgba, same)) + " parent=" + String(parentClass !== null),
  );
  // A pointer record: HarfBuzz's `hb_language_t` is itself a `const struct
  // hb_language_impl_t *`, held as the handle it is. "en-US" comes back as
  // HarfBuzz writes it, and is a more specific "en".
  const english = hb_language_from_string(new Uint8Array([101, 110]));
  const american = hb_language_from_string(new Uint8Array([101, 110, 45, 85, 83]));
  console.log("hb " + hb_language_to_string(american) + " " + String(hb_language_matches(english, american) !== 0));
  // What GIR describes and its own headers do not include. The GTK
  // platform's bind request names glib/gstdio.h's g_access, HarfBuzz's
  // OpenType API, Gio's gnetworking.h and GTK's unix-print types for every
  // program; nts.config.ts's `girExtras` adds Gio's settings backend behind
  // G_SETTINGS_ENABLE_BACKEND and GdkPixbuf's animation class struct behind
  // GDK_PIXBUF_ENABLE_BACKEND, which a library keeps for its implementers.
  const tagged = hb_ot_tag_to_language(0x454e4720);
  g_networking_init();
  console.log(
    "reach access=" + String(g_access("/", 0)) +
      " ot=" + (tagged === null ? "none" : hb_language_to_string(tagged)) +
      " backend=" + String(g_null_settings_backend_new() !== null) +
      " print=" + String(gtk_print_unix_dialog_get_type() !== 0n) +
      " net still=" + String(gdk_pixbuf_animation_is_static_image(new StillImage())),
  );
  // A face of two tables, and a set the program made for HarfBuzz to fill.
  const cmap = new Uint8Array([
    0, 0, 0, 1, // version 0, one encoding record
    0, 3, 0, 1, 0, 0, 0, 12, // Windows Unicode BMP, its subtable at 12
    0, 4, 0, 32, 0, 0, // format 4, 32 bytes, no language
    0, 4, 0, 4, 0, 1, 0, 0, // two segments: searchRange 4, entrySelector 1, rangeShift 0
    0, 0x41, 0xff, 0xff, // endCode
    0, 0, // reservedPad
    0, 0x41, 0xff, 0xff, // startCode
    0xff, 0xc0, 0, 1, // idDelta: U+0041 is glyph 1, U+FFFF glyph 0
    0, 0, 0, 0, // idRangeOffset
  ]);
  const maxp = new Uint8Array([0, 0, 0x50, 0, 0, 2]); // version 0.5, two glyphs
  const built = hb_face_builder_create();
  hb_face_builder_add_table(built, 0x636d6170, hb_glib_blob_create(g_bytes_new(cmap)));
  hb_face_builder_add_table(built, 0x6d617870, hb_glib_blob_create(g_bytes_new(maxp)));
  const unicodes = hb_set_create();
  hb_face_collect_unicodes(built, unicodes);
  console.log("collected " + String(hb_set_get_population(unicodes)) + " " + String(hb_set_has(unicodes, 0x41) !== 0));
  // HarfBuzz's AAT API (hb-aat.h): the face has no `morx` table to substitute by.
  console.log("aat " + String(hb_aat_layout_has_substitution(built)));
  // Storage of the program's own, which C reads and rewrites.
  const extents = local<PangoRectangle>();
  extents.x = 1024;
  extents.y = 2048;
  extents.width = 3072;
  extents.height = 4096;
  pango_extents_to_pixels(extents, null);
  console.log(
    "rect " + String(extents.x) + "," + String(extents.y) + " " + String(extents.width) + "x" + String(extents.height),
  );
  // A path point the program boxes, which GTK reads and moves along.
  const line = gsk_path_parse("M 0 0 L 10 0");
  if (line !== null) {
    const point = new GskPathPoint();
    gsk_path_get_start_point(line, point);
    const moved = gsk_path_get_next(line, point);
    const position = new graphene_point_t();
    gsk_path_point_get_position(point, line, position);
    const along = graphene_point_distance(position, graphene_point_zero(), null, null);
    console.log("path " + String(moved) + " " + String(along) + " " + String(gsk_path_get_next(line, point)));
  }
  // A record GObject fills, with a string member the program reads.
  const query = local<GTypeQuery>();
  g_type_query(gtk_button_get_type(), query);
  console.log("query " + (stringFrom(query.type_name) ?? "none"));
  // A `GType` property, read back as the `gsize` C holds it in.
  const store = new GListStore({ item_type: gtk_button_get_type() });
  console.log(
    "store " + String(store.get_item_type() === gtk_button_get_type()) + " " +
      String(store.item_type === gtk_button_get_type()),
  );
  // A C typedef Gio names as a type of its own: the integer it is.
  console.log("pid " + String(g_credentials_new().get_unix_pid() > 0));
  // Raw pointers to storage the program allocates and frees: a count C reads
  // and raises, and a datalist C keeps its flags in. Heap storage, since a
  // pointer GIR says nothing about may be kept, for all the binding can tell.
  const count = malloc<c_int>(sizeof<c_int>());
  const datalist = malloc<GData | null>(sizeof<GData | null>());
  if (count !== null && datalist !== null) {
    g_atomic_ref_count_init(count);
    g_atomic_ref_count_inc(count);
    const raised = g_atomic_ref_count_compare(count, 2);
    datalist[0] = null;
    g_datalist_set_flags(datalist, 1);
    console.log(
      "refcount " + String(count[0]) + " " + String(raised) + " flags " + String(g_datalist_get_flags(datalist)),
    );
  }
  free(count);
  free(datalist);
  // A name GLib gives a scalar, which the program names too.
  const quark: GQuark = g_quark_from_string("nts");
  console.log("quark " + g_quark_to_string(quark));
  // A slot GIR does not call out: the raw pointer the header writes, where
  // parsing stopped, in storage the program allocates, since a raw pointer
  // may be kept for all the binding can tell.
  const stop = malloc<ConstPtr<c_char> | null>(sizeof<ConstPtr<c_char> | null>());
  if (stop !== null) {
    stop[0] = null;
    const parsed = g_variant_parse(null, "7 tail", null, stop);
    console.log("parsed " + String(parsed.get_int32()) + (stringFrom(stop[0]) ?? " none"));
  }
  free(stop);
  // One handed over, and one a getter lends back, which the program copies.
  const given = pango_font_description_from_string("Sans 12");
  const context = pango_context_new();
  context.set_font_description(given);
  const lent = context.get_font_description();
  console.log("font " + (lent === null ? "none" : lent.get_family() ?? "none"));
}

function outParameters(): void {
  const when = g_date_time_new_utc(2026, 9, 24, 0, 0, 0);
  if (when === null) {
    console.log("no-date");
    return;
  }
  const year = local<c_int>();
  const month = local<c_int>();
  g_date_time_get_ymd(when, year, month, null);
  console.log("ymd=" + String(year[0]) + "-" + String(month[0]));
  // The same as GJS has it: the out values returned, in order.
  const [y, m, d] = when.get_ymd();
  console.log("values=" + String(y) + "/" + String(m) + "/" + String(d));
  g_date_time_unref(when);

  // A string out of a slot: `char *` C wrote there, read by `stringFrom`
  // (copied; the pointer is still C's to free), and a NULL read as `null`.
  const stripped = local<Ptr<c_char>>();
  pango_parse_markup("<b>bold</b> x", -1, 0, null, stripped);
  const markup = stringFrom(stripped[0]);
  g_free(stripped[0]);
  console.log("markup=" + (markup ?? "none") + "|" + (stringFrom(null) ?? "none"));

  // A string GLib `#define`s, which the binding declares as its literal type.
  console.log("group " + G_KEY_FILE_DESKTOP_GROUP);

  const keys = g_key_file_new();
  const error = local<GError | null>();
  const text = "[a]\nk=5\n";
  const loaded = g_key_file_load_from_data(keys, text, text.length, KeyFileFlags.NONE, error);
  const k = g_key_file_get_integer(keys, "a", "k", error);
  console.log("keyfile " + String(loaded) + " " + String(k) + " " + (error[0] === null ? "no-error" : "error"));
  // Arrays C hands back, their length in a slot, copied.
  const lists = g_key_file_new();
  const listed = "[l]\ns=x;y;z\nn=1;2;3\n";
  g_key_file_load_from_data(lists, listed, listed.length, KeyFileFlags.NONE, error);
  console.log(
    "copied " + lists.get_string_list("l", "s").join("|") + " " +
      g_key_file_get_integer_list(lists, "l", "n").join(",") + " argv " +
      g_shell_parse_argv("a 'b c'").join("|"),
  );
  // Arrays C hands back ended by a zero, counted to it and copied.
  const [tokens, alternates] = g_str_tokenize_and_fold("Hello wörld", null);
  const [spawned] = g_spawn_command_line_sync("printf ab");
  console.log(
    "folded " + tokens.join("|") + " " + alternates.join("|") + " spawned " +
      String(spawned[0]) + "," + String(spawned[1]),
  );
  const missing = g_key_file_get_integer(keys, "a", "absent", error);
  const failure = error[0];
  if (failure !== null) {
    console.log("error-set " + String(missing));
    g_error_free(failure);
    error[0] = null;
  }
  // `@ntsThrows`: leave the slot out, and a failure is thrown.
  try {
    keys.get_integer("a", "absent");
    console.log("not-thrown");
  } catch (e) {
    console.log((e as Error).message.length > 0 ? "thrown" : "thrown-empty");
  }
  g_key_file_unref(keys);

  console.log("split=" + g_strsplit("a,b,c", ",", -1).join("|"));

  // `subarray` starts one byte in, so a pointer to the buffer rather than the
  // view would hash "_ab" instead.
  const abc = new Uint8Array([0x5f, 0x61, 0x62, 0x63, 0x5f]).subarray(1, 4);
  // An enum member as it is: the parameter is `CEnum<GChecksumType, c_uint>`.
  const digest = g_compute_checksum_for_data(ChecksumType.SHA256, abc);
  console.log("sha256=" + (digest === null ? "none" : digest.slice(0, 8)));

  // The header's `const`, where GIR's spelling drops it: the same view lent
  // to `g_output_stream_write` as `const void *` (GIR writes `void*`), read
  // back from the memory stream it went into.
  const sink = g_memory_output_stream_new_resizable();
  const wrote = g_output_stream_write(sink, abc);
  g_output_stream_close(sink);
  const written = g_memory_output_stream_steal_as_bytes(sink).get_data();
  let readBack = "";
  for (let at = 0; at < written.length; at++) readBack += String.fromCharCode(written[at]);
  console.log("write " + String(wrote) + " " + readBack);

  const flusher = new Flusher();
  const flushed = g_output_stream_flush(flusher);
  let refused = "none";
  try {
    g_output_stream_flush(flusher);
  } catch (e) {
    refused = (e as Error).message;
  }
  console.log("vfunc flushed=" + String(flushed) + " count=" + String(flusher.flushes) + " thrown=" + refused);
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
// passed as NULL, called directly; and a construct property left out, which
// the constructor is passed as NULL.
function absentArrays(): void {
  const direct = gtk_string_list_new(null);
  const constructed = new GtkStringList({});
  const given = new GtkStringList({ strings: ["a", "b"] });
  console.log("lists " + String(direct.get_n_items()) + " " + String(constructed.get_n_items()) + " " + String(given.get_n_items()));
}

// Bytes C hands back. A `GBytes`' own (transfer none) are copied, so the copy
// outlives the `GBytes`, which is gone by the time `held` returns. A file's
// contents (transfer full) are copied, and C's buffer freed.
function held(): Uint8Array {
  const bytes = g_bytes_new(new Uint8Array([104, 105]));
  return bytes.get_data();
}

function bytesOut(): string {
  const kept = held();
  const file = g_file_new_for_path("/usr/share/gir-1.0/GLib-2.0.gir");
  // GJS's shape: a throwing function's `gboolean` is left out, since
  // failing throws.
  const contents = file.load_contents(null);
  let head = "";
  for (let at = 0; at < 5; at++) head += String.fromCharCode(contents[at]);
  return "bytes " + String(kept.length) + ":" + String(kept[0]) + "," + String(kept[1]) + " " + head;
}

// The same, awaited: `load_contents_async`'s Promise settles with what its
// `_finish` hands back through out slots, the contents.
async function bytesAwaited(): Promise<void> {
  const contents = await g_file_new_for_path("/usr/share/gir-1.0/GLib-2.0.gir").load_contents_async(null);
  let head = "";
  for (let at = 0; at < 5; at++) head += String.fromCharCode(contents[at]);
  console.log("awaited " + head + " " + String(contents.length > 1000));
  awaited = true;
}

// Whether `bytesAwaited` has logged: the timeout below waits for it as it
// waits for `kind` and `folders`, because the read settles on GIO's thread
// pool and a loaded machine finished the three ticks first (the log then read
// `label=tick 3` before `awaited`, and the gate's interop step went red on
// unrelated landings).
let awaited = false;

function main(): void {
  outParameters();
  boxedRecords();
  absentArrays();
  void learnKind();
  void directories("/tmp/nts-gtk-gir-directory");
  const application = gtk_application_new("dev.nts.GtkGir", ApplicationFlags.NON_UNIQUE);
  // GObject retains the address: allocate it, remove the data, then free it.
  // Both GIR-returned gpointers stay raw, with no inferred deallocator.
  const raw = g_malloc0(1);
  g_object_set_data(application, "nts-raw-pointer", raw);
  const roundTrip = g_object_get_data(application, "nts-raw-pointer");
  const pointerByte = roundTrip === null ? -1 : bytesFrom(roundTrip, 1)[0];
  console.log("pointer=" + String(roundTrip === raw) + ":" + String(pointerByte));
  // The same raw address is accepted by a const void* input. The copied
  // address stays raw too, so the caller supplies its documented g_free.
  const copy = g_memdup2(raw, 1);
  console.log("const-pointer=" + String(copy !== null && bytesFrom(copy, 1)[0] === 0));
  g_free(copy);
  g_object_set_data(application, "nts-raw-pointer", null);
  g_free(raw);
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
    console.log("made " + String(button.label) + " " + String(button.has_frame));
    // A record known by its alias, as the record it stands for: a layout
    // with the display's fonts, which a context of the program's own lacks.
    const layout = gtk_widget_create_pango_layout(button, "hello");
    const iter = pango_layout_get_iter(layout);
    console.log("run " + String(pango_layout_iter_get_run(iter) !== null));
    // Construct-only properties, which no setter writes, given to
    // `g_object_new`: GJS's `new Gio.ThemedIcon({ name })`, with a boolean
    // one beside it that adds the name's fallbacks.
    const icon = new GThemedIcon({ name: "document-open-recent", use_default_fallbacks: true });
    const names = icon.get_names();
    console.log("themed " + String(names.length) + " " + names[0]);
    // A property read before it is written, GJS's `page.badge_number -= 1`:
    // the getter, then the setter, on one receiver. With operators whose
    // answer is always a C `int`: `+= 3` on an `int` could overflow it, and
    // strict refuses what it cannot prove fits.
    const counted = new GtkLabel({ width_chars: 2 });
    counted.width_chars |= 4;
    counted.width_chars ^= 0;
    console.log("compound " + String(counted.width_chars));
    // A `gpointer` result the caller owns that is a GObject
    // (`Owned<Erased<GObject>>`): adopted rather than referenced again, and
    // released once -- `fatal-criticals` under `--rc` would abort on a count
    // taken from a reference nobody gave.
    const group = g_signal_group_new(gtk_button_get_type());
    group.set_target(button);
    const target = group.dup_target();
    console.log("dup-target " + String(target === button));
    // Not floating: the program's own reference, which `--rc` releases once.
    const buffer = new GtkEntryBuffer({ max_length: 2 });
    buffer.set_text("abc", -1);
    console.log("buffer " + buffer.text + " " + String(label.selectable));
    // A signal passing a string, which GTK lends the handler for the call:
    // `inserted-text` (position, chars, n_chars) as GTK emits it.
    let inserted = "";
    buffer.connect("inserted-text", (_self, position, chars, n_chars) => {
      inserted += String(position) + ":" + chars + ":" + String(n_chars);
    });
    buffer.set_text("", -1);
    buffer.insert_text(0, "x", -1);
    console.log("inserted " + inserted);
    // A detailed signal, as GJS connects one: `notify::label` runs for that
    // property's changes and no other's.
    let relabeled = 0;
    label.connect("notify::label", () => {
      relabeled++;
    });
    label.set_label("one");
    label.set_selectable(false);
    label.set_label("two");
    console.log("relabeled " + String(relabeled));
    console.log(bytesOut());
    void bytesAwaited();
    // An interface's methods and properties on a class implementing it, as
    // GJS has them: `GtkEditable`'s on a `GtkEntry`, `GtkOrientable`'s on a
    // `GtkBox` -- each the C function taking the interface.
    const entry = new GtkEntry({});
    entry.set_text("typed");
    entry.text = entry.get_text() + "!";
    box.set_orientation(Orientation.HORIZONTAL);
    console.log("entry " + entry.text + " " + String(box.get_orientation()));
    // The function's own result first, then its out values.
    entry.select_region(1, 3);
    const [selected, start, end] = entry.get_selection_bounds();
    console.log("bounds " + String(selected) + " " + String(start) + " " + String(end));
    // A checked narrowing, for a handle known only as a widget.
    const widget: GtkWidget = box;
    console.log(widget instanceof GtkBox ? "cast-ok" : "cast-failed");
    console.log(widget instanceof GtkLabel ? "cast-wrong" : "cast-null");
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
      console.log(self instanceof GtkButton ? "clicked " + String(clicks) : "clicked-not-a-button");
    });
    button.emit("clicked");
    console.log("order=" + order);
    // A `GSourceFunc` answers a `gboolean`, as GJS writes it: `false`
    // removes the source, `true` keeps it.
    g_idle_add_full(PRIORITY_DEFAULT, () => {
      console.log("idle");
      return false;
    });
    // The button's allocation, in a box of the program's that GTK fills: a
    // `GtkAllocation` is a `GdkRectangle`. Empty until the window is laid
    // out, which the timeout below waits for.
    const allocation = new GdkRectangle();
    const empty = new GdkRectangle();
    g_timeout_add_full(PRIORITY_DEFAULT, 10, () => {
      // Count only to three, and keep the source until the query, the
      // directories, the awaited read and the layout have answered too: on a
      // loaded machine any of them can outlast three ticks, and the log must
      // read tick 3 after them either way.
      if (ticks < 3) {
        ticks++;
        label.label = "tick " + String(ticks);
      }
      gtk_widget_get_allocation(button, allocation);
      const laid = !allocation.equal(empty);
      if (ticks < 3 || kind === -1 || folders === "" || !awaited || !laid) return true;
      console.log("label=" + label.label);
      console.log("allocation laid");
      application.quit();
      return false;
    });
  });
  // `argv` as a `string[]`, lent to C as `char **` with `argc` beside it.
  // GApplication parses it, so it holds only the program name: an option it
  // does not know would end the run.
  const status = application.run(["gir"]);
  console.log("status=" + String(status));
  console.log("ticks=" + String(ticks));
  console.log("kind=" + String(kind));
  console.log(folders);
  console.log("sorted=" + sortedByLastLetter(["apple", "kiwi", "banana"]));
}

function lastLetter(item: unknown): string | null {
  if (!(item instanceof GtkStringObject)) return null;
  const text = item.get_string();
  return text.substring(text.length - 1);
}

function sortedByLastLetter(words: string[]): string {
  const expression = gtk_cclosure_expression_new(G_TYPE_STRING, (item) => lastLetter(item));
  const sorted = new GtkSortListModel({ model: gtk_string_list_new(words), sorter: new GtkStringSorter({ expression }) });
  const order: string[] = [];
  for (let at = 0; at < sorted.get_n_items(); at++) {
    const item = sorted.get_item(at);
    if (item instanceof GtkStringObject) order.push(item.get_string());
  }
  return order.join("|");
}

main();
