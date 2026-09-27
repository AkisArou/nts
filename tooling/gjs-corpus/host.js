// The GJS side of the corpus: a Workbench demo run as Workbench's own CLI
// runs it (`src/cli/javascript.js` there), headless, then driven.
//
//   NTS_CORPUS_DEMO=<port dir> gjs -m host.js <demo's main.js>
//
// The port's directory holds the demo's Blueprint compiled to `main.ui` and
// `driver.txt`, one action a line, which the nts port's host reads too:
//
//   click <id>     emit `clicked` on the builder's object <id>
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
  for (const [kind, id] of actions) {
    if (kind === "click") builder.get_object(id).emit("clicked");
    else throw new Error(`unknown action ${kind}`);
  }
  GLib.idle_add(GLib.PRIORITY_LOW, () => {
    application.quit();
    return GLib.SOURCE_REMOVE;
  });
});
application.run([]);
