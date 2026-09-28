// The GJS side of the corpus: a Workbench demo run as Workbench's own CLI
// runs it (`src/cli/javascript.js` there), headless, then driven.
//
//   NTS_CORPUS_DEMO=<port dir> gjs -m host.js <demo's main.js>
//
// `workbench.resolve(path)` is relative to the demo's own directory, where
// its assets are, as Workbench resolves it.
//
// The port's directory holds the demo's Blueprint compiled to `main.ui` and
// `driver.txt`, one action a line, which the nts port's host reads too:
//
//   click <id>     emit `clicked` on the builder's object <id>
//   toggle <id>    flip `active` on a check button, toggle button or switch
//   label <id>     print a label's or button's `label`
//   close <id>     emit a popover's `closed`
//   pick <id> <text> emit an emoji chooser's `emoji-picked`
//   day <id> <y> <m> <d> select a calendar's day
//   action <id> <name> [text] activate a widget's action, with a string or none
//   file <id>      print the name of a picture's or image's file
//   sidebar-position <id> print a split view's `sidebar_position`
//   text <id> <words> set an entry's text
//   attributes <id> print a label's Pango attributes as their string
//   pages <id>     print a tab view's or carousel's `n_pages`
//   buffer <id>    print how many characters a text view's buffer holds
//   n-items <id>   print how many items a column view's model holds
//   draw <id>      show the window and run the main loop until the widget is
//                  laid out and two frames have passed: a factory binds then
//   labels <id>    print the labels below a widget, depth first
//   sort <id> <n>  sort a column view by its nth column, ascending
//   close-dialog <id> ask a dialog to close, as its close button does
//   activate-child <id> <n> activate a flow box's nth child
//   active <id>    print `active`
//   visible <id>   print `visible`
//   sensitive <id> print `sensitive`
//   icon <id>      print a button's `icon_name`
//   classes <id>   print a widget's CSS classes, comma separated
//   value <id> <n> set a range's or spin button's value
//   spin <id>      step a spin button forward by one
//   activate <id>  a button row's `activated`, a banner's `button-clicked`
//   select <id> <n> set a combo row's `selected`
//   revealed <id>  print an action bar's or banner's `revealed`
//   children <id>  print how many children a widget has
//   click-child <id> <n> emit `clicked` on a flow box's nth child's widget
//   visible-child <id> print the builder id of a stack's visible child
//   search-changed <id> emit a search entry's `search-changed`, which it
//                  otherwise emits after a delay
//   badge <id>     print a view stack page's `badge_number`
//   click-in <id> <n> emit `clicked` on the first button in a list box's nth row
//   level <id>     print a level bar's `value`
//   visit <id>     mark a link button visited
//   breakpoint <id> <apply|unapply> emit a breakpoint's signal
//   respond <id> <response> answer the alert dialog shown in <id>'s window
//   about <id>     print the about dialog shown in <id>'s window: its name,
//                  comments and translator credits
//   orientation <id> print a box's `orientation`
//
// The demo's own `console.log` lines are the log, on stdout and whole: GJS
// writes them to stderr through GLib's logger, where a message's second line
// has no prefix to find it by, so a writer here takes them first.
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";

const decoder = new TextDecoder();
GLib.log_set_writer_func((level, fields) => {
  const domain = fields.GLIB_DOMAIN ? decoder.decode(fields.GLIB_DOMAIN) : "";
  if (domain === "Gjs-Console" && level === GLib.LogLevelFlags.LEVEL_MESSAGE) {
    print(decoder.decode(fields.MESSAGE));
    return GLib.LogWriterOutput.HANDLED;
  }
  // Everything else goes to stderr as before, through GLib's fallback.
  return GLib.LogWriterOutput.UNHANDLED;
});

const dir = GLib.getenv("NTS_CORPUS_DEMO");
const [main] = ARGV;
const port = Gio.File.new_for_path(dir);
const actions = decoder
  .decode(port.get_child("driver.txt").load_contents(null)[1])
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => line.trim().split(/\s+/));

function draw(window, widget) {
  window.present();
  // A timer keeps a blocking iteration from waiting on nothing.
  const tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => GLib.SOURCE_CONTINUE);
  const context = GLib.MainContext.default();
  while (widget.get_width() === 0) context.iteration(true);
  const clock = widget.get_frame_clock();
  if (clock !== null) {
    const start = clock.get_frame_counter();
    widget.queue_resize();
    while (clock.get_frame_counter() < start + 2) context.iteration(true);
  }
  GLib.source_remove(tick);
}

function firstButton(widget) {
  for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
    if (child instanceof Gtk.Button) return child;
    const below = firstButton(child);
    if (below !== null) return below;
  }
  return null;
}

function labels(widget, out = []) {
  for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
    if (child instanceof Gtk.Label) out.push(child.label);
    labels(child, out);
  }
  return out;
}

function children(widget) {
  let count = 0;
  for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) count++;
  return count;
}

const application = new Adw.Application({ application_id: "dev.nts.Corpus", flags: Gio.ApplicationFlags.NON_UNIQUE });
application.connect("activate", async () => {
  const window = new Adw.ApplicationWindow({ application });
  const builder = new Gtk.Builder();
  const ui = decoder.decode(port.get_child("main.ui").load_contents(null)[1]);
  // A UI that is a template is the demo's to register, as `workbench.template`,
  // and builds nothing here, as in Workbench. A template is the UI's first
  // element, before any object: a list item factory's bytes hold a
  // `<template>` of their own, nested in an object.
  const at = ui.indexOf("<template ");
  const object = ui.indexOf("<object ");
  const template = at >= 0 && (object < 0 || at < object) ? ui : null;
  if (template === null) builder.add_from_file(port.get_child("main.ui").get_path());
  // Previewed as Workbench previews it: in the window, unless it is one.
  // The UI's first object, which new-port.sh names where Blueprint does not.
  const [, rootId] = (template === null && /<object [^>]*id="([^"]*)"/.exec(ui)) || [];
  const root = rootId ? builder.get_object(rootId) : null;
  if (root instanceof Gtk.Widget && !(root instanceof Gtk.Window)) window.content = root;
  globalThis.workbench = {
    window,
    application,
    builder,
    template,
    resolve(path) {
      return Gio.File.new_for_path(main).get_parent().resolve_relative_path(path).get_uri();
    },
    // What the demo makes, shown in the window and named `preview` to the
    // driver.
    preview(widget) {
      window.content = widget;
      builder.expose_object("preview", widget);
    },
  };
  await import(`file://${main}`);
  for (const [kind, id, ...args] of actions) {
    const object = builder.get_object(id);
    if (kind === "click") object.emit("clicked");
    else if (kind === "toggle") object.active = !object.active;
    else if (kind === "label") console.log(`${id}.label ${object.label}`);
    else if (kind === "active") console.log(`${id}.active ${object.active}`);
    else if (kind === "sensitive") console.log(`${id}.sensitive ${object.sensitive}`);
    else if (kind === "visible") console.log(`${id}.visible ${object.visible}`);
    else if (kind === "icon") console.log(`${id}.icon ${object.icon_name}`);
    else if (kind === "value") object.set_value(Number(args[0]));
    else if (kind === "spin") object.spin(Gtk.SpinType.STEP_FORWARD, 1);
    else if (kind === "activate") object.emit(object instanceof Adw.Banner ? "button-clicked" : "activated");
    else if (kind === "select") object.selected = Number(args[0]);
    else if (kind === "revealed") console.log(`${id}.revealed ${object.revealed}`);
    else if (kind === "children") console.log(`${id}.children ${children(object)}`);
    else if (kind === "orientation") console.log(`${id}.orientation ${object.orientation}`);
    else if (kind === "close") object.emit("closed");
    else if (kind === "pick") object.emit("emoji-picked", args[0]);
    else if (kind === "day") object.select_day(GLib.DateTime.new_local(Number(args[0]), Number(args[1]), Number(args[2]), 0, 0, 0));
    else if (kind === "action") object.activate_action(args[0], args.length > 1 ? GLib.Variant.new_string(args[1]) : null);
    else if (kind === "visible-child") console.log(`${id}.visible_child ${object.visible_child === null ? "none" : (object.visible_child.get_buildable_id() ?? "?")}`);
    else if (kind === "search-changed") object.emit("search-changed");
    else if (kind === "badge") console.log(`${id}.badge_number ${object.badge_number}`);
    else if (kind === "click-in") firstButton(object.get_row_at_index(Number(args[0]))).emit("clicked");
    else if (kind === "level") console.log(`${id}.value ${object.value}`);
    else if (kind === "visit") object.visited = true;
    else if (kind === "breakpoint") object.emit(args[0]);
    else if (kind === "respond") object.get_root().get_visible_dialog().emit("response", args[0]);
    else if (kind === "about") {
      const dialog = object.get_root().get_visible_dialog();
      console.log(`about ${dialog.application_name}|${dialog.comments}|${dialog.translator_credits}`);
    } else if (kind === "click-child") object.get_child_at_index(Number(args[0])).child.emit("clicked");
    else if (kind === "activate-child") object.get_child_at_index(Number(args[0])).activate();
    else if (kind === "file") console.log(`${id}.file ${object instanceof Gtk.Picture ? object.file?.get_basename() : GLib.path_get_basename(object.file ?? "")}`);
    else if (kind === "sidebar-position") console.log(`${id}.sidebar_position ${object.sidebar_position}`);
    else if (kind === "text") object.text = args.join(" ");
    else if (kind === "attributes") console.log(`${id}.attributes ${object.attributes?.to_string() ?? ""}`);
    else if (kind === "pages") console.log(`${id}.n_pages ${object.n_pages}`);
    else if (kind === "buffer") console.log(`${id}.buffer ${object.buffer.get_char_count()}`);
    else if (kind === "close-dialog") object.close();
    else if (kind === "n-items") console.log(`${id}.n_items ${object.model?.get_n_items() ?? 0}`);
    else if (kind === "draw") draw(window, object);
    else if (kind === "labels") console.log(`${id}.labels ${labels(object).join(",")}`);
    else if (kind === "sort") object.sort_by_column(object.columns.get_item(Number(args[0])), Gtk.SortType.ASCENDING);
    else if (kind === "classes") console.log(`${id}.classes ${object.get_css_classes().join(",")}`);
    else throw new Error(`unknown action ${kind}`);
  }
  GLib.idle_add(GLib.PRIORITY_LOW, () => {
    application.quit();
    return GLib.SOURCE_REMOVE;
  });
});
application.run([]);
