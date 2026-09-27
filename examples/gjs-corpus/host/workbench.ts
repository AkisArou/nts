// The nts side of the corpus: what Workbench gives a demo -- `workbench.builder`
// loaded from the demo's UI, the window, the application -- and the driver
// that exercises it once the demo has run. The GJS side is
// tooling/gjs-corpus/host.js, which reads the same `driver.txt`.
//
// A port's demo is a function the host calls, where the original runs as the
// module Workbench imports: nts compiles no dynamic `import()`.
import { AdwApplication, AdwApplicationWindow, AdwSwitchRow } from "c:Adw-1";
import { GtkBuilder, GtkButton, GtkCheckButton, GtkLabel, GtkSwitch, GtkToggleButton, GtkWidget } from "c:Gtk-4.0";
import { ApplicationFlags, g_data_input_stream_new, g_file_new_for_path } from "c:Gio-2.0";
import { GObject } from "c:GObject-2.0";
import { g_getenv, g_timeout_add_full } from "c:GLib-2.0";

export interface Workbench {
  readonly application: AdwApplication;
  readonly window: AdwApplicationWindow;
  readonly builder: GtkBuilder;
  resolve(path: string): string;
}

/** The driver's actions, one a line; tooling/gjs-corpus/host.js lists them. */
function actions(path: string): string[][] {
  const stream = g_data_input_stream_new(g_file_new_for_path(path).read(null));
  const out: string[][] = [];
  for (;;) {
    const [line] = stream.read_line_utf8(null);
    if (line === null) break;
    const words = line.trim().split(" ").filter((word) => word !== "");
    if (words.length > 0) out.push(words);
  }
  stream.close(null);
  return out;
}

/** One action on the builder's object `id`, as host.js applies it. */
function act(kind: string, id: string, object: GObject | null): boolean {
  switch (kind) {
    case "click":
      if (!(object instanceof GtkButton)) return false;
      object.emit("clicked");
      return true;
    case "toggle":
      if (object instanceof GtkCheckButton) object.active = !object.active;
      else if (object instanceof GtkToggleButton) object.active = !object.active;
      else if (object instanceof GtkSwitch) object.active = !object.active;
      else if (object instanceof AdwSwitchRow) object.active = !object.active;
      else return false;
      return true;
    case "label":
      if (!(object instanceof GtkLabel)) return false;
      console.log(`${id}.label ${object.label}`);
      return true;
    case "active":
      if (object instanceof GtkCheckButton) console.log(`${id}.active ${object.active}`);
      else if (object instanceof GtkToggleButton) console.log(`${id}.active ${object.active}`);
      else if (object instanceof GtkSwitch) console.log(`${id}.active ${object.active}`);
      else if (object instanceof AdwSwitchRow) console.log(`${id}.active ${object.active}`);
      else return false;
      return true;
    case "visible":
      if (!(object instanceof GtkWidget)) return false;
      console.log(`${id}.visible ${object.visible}`);
      return true;
    case "icon":
      if (!(object instanceof GtkButton)) return false;
      console.log(`${id}.icon ${object.icon_name}`);
      return true;
    case "classes":
      if (!(object instanceof GtkWidget)) return false;
      console.log(`${id}.classes ${object.get_css_classes().join(",")}`);
      return true;
    default:
      return false;
  }
}

function drive(builder: GtkBuilder, path: string): void {
  for (const [kind, id] of actions(path)) {
    if (!act(kind, id, builder.get_object(id))) console.log("driver: cannot " + kind + " " + id);
  }
}

/** Run `demo` as Workbench does, then drive it, then quit. */
export function run(demo: (workbench: Workbench) => void): void {
  const dir = g_getenv("NTS_CORPUS_DEMO") ?? ".";
  const application = new AdwApplication({ application_id: "dev.nts.Corpus", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    const window = new AdwApplicationWindow({ application });
    const builder = new GtkBuilder({});
    builder.add_from_file(dir + "/main.ui");
    demo({
      application,
      window,
      builder,
      resolve: (path) => g_file_new_for_path(dir).resolve_relative_path(path).get_uri(),
    });
    drive(builder, dir + "/driver.txt");
    g_timeout_add_full(0, 0, () => {
      application.quit();
      return false;
    });
  });
  application.run([]);
}
