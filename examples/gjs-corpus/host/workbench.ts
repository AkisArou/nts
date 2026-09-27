// The nts side of the corpus: what Workbench gives a demo -- `workbench.builder`
// loaded from the demo's UI, the window, the application -- and the driver
// that exercises it once the demo has run. The GJS side is
// tooling/gjs-corpus/host.js, which reads the same `driver.txt`.
//
// A port's demo is a function the host calls, where the original runs as the
// module Workbench imports: nts compiles no dynamic `import()`.
import { AdwApplication, AdwApplicationWindow } from "c:Adw-1";
import { GtkBuilder, GtkButton } from "c:Gtk-4.0";
import { ApplicationFlags, g_data_input_stream_new, g_file_new_for_path } from "c:Gio-2.0";
import { g_getenv, g_timeout_add_full } from "c:GLib-2.0";

export interface Workbench {
  readonly application: AdwApplication;
  readonly window: AdwApplicationWindow;
  readonly builder: GtkBuilder;
  resolve(path: string): string;
}

/** The driver's actions, one a line: `click <id>`. */
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

function drive(builder: GtkBuilder, path: string): void {
  for (const [kind, id] of actions(path)) {
    const object = builder.get_object(id);
    if (kind === "click" && object instanceof GtkButton) object.emit("clicked");
    else console.log("driver: cannot " + kind + " " + id);
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
