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
//   label <id>     print a label's `label`
//   active <id>    print `active`
//   visible <id>   print `visible`
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
// The demo's own `console.log` lines are the log; nothing else prints.
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";

const dir = GLib.getenv("NTS_CORPUS_DEMO");
const [main] = ARGV;
const port = Gio.File.new_for_path(dir);
const actions = new TextDecoder()
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
  for (const [kind, id, arg] of actions) {
    const object = builder.get_object(id);
    if (kind === "click") object.emit("clicked");
    else if (kind === "toggle") object.active = !object.active;
    else if (kind === "label") console.log(`${id}.label ${object.label}`);
    else if (kind === "active") console.log(`${id}.active ${object.active}`);
    else if (kind === "visible") console.log(`${id}.visible ${object.visible}`);
    else if (kind === "icon") console.log(`${id}.icon ${object.icon_name}`);
    else if (kind === "value") object.set_value(Number(arg));
    else if (kind === "spin") object.spin(Gtk.SpinType.STEP_FORWARD, 1);
    else if (kind === "activate") object.emit(object instanceof Adw.Banner ? "button-clicked" : "activated");
    else if (kind === "select") object.selected = Number(arg);
    else if (kind === "revealed") console.log(`${id}.revealed ${object.revealed}`);
    else if (kind === "children") console.log(`${id}.children ${children(object)}`);
    else if (kind === "orientation") console.log(`${id}.orientation ${object.orientation}`);
    else if (kind === "classes") console.log(`${id}.classes ${object.get_css_classes().join(",")}`);
    else throw new Error(`unknown action ${kind}`);
  }
  GLib.idle_add(GLib.PRIORITY_LOW, () => {
    application.quit();
    return GLib.SOURCE_REMOVE;
  });
});
application.run([]);
