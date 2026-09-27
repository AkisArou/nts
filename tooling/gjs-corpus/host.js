// The GJS side of the corpus: a Workbench demo run as Workbench's own CLI
// runs it (`src/cli/javascript.js` there), headless, then driven.
//
//   NTS_CORPUS_DEMO=<port dir> gjs -m host.js <demo's main.js>
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
//   action <id> <name> <text> activate a widget's action with a string
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

function children(widget) {
  let count = 0;
  for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) count++;
  return count;
}

const application = new Adw.Application({ application_id: "dev.nts.Corpus", flags: Gio.ApplicationFlags.NON_UNIQUE });
application.connect("activate", async () => {
  const window = new Adw.ApplicationWindow({ application });
  const builder = new Gtk.Builder();
  builder.add_from_file(port.get_child("main.ui").get_path());
  globalThis.workbench = {
    window,
    application,
    builder,
    template: null,
    resolve(path) {
      return port.resolve_relative_path(path).get_uri();
    },
    preview() {},
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
    else if (kind === "action") object.activate_action(args[0], GLib.Variant.new_string(args[1]));
    else if (kind === "classes") console.log(`${id}.classes ${object.get_css_classes().join(",")}`);
    else throw new Error(`unknown action ${kind}`);
  }
  GLib.idle_add(GLib.PRIORITY_LOW, () => {
    application.quit();
    return GLib.SOURCE_REMOVE;
  });
});
application.run([]);
