// The nts side of the corpus: what Workbench gives a demo -- `workbench.builder`
// loaded from the demo's UI, the window, the application -- and the driver
// that exercises it once the demo has run. The GJS side is
// tooling/gjs-corpus/host.js, which reads the same `driver.txt`.
//
// A port's demo is a function the host calls, where the original runs as the
// module Workbench imports: nts compiles no dynamic `import()`.
import {
  AdwApplication,
  AdwApplicationWindow,
  AdwBanner,
  AdwButtonRow,
  AdwCarousel,
  AdwComboRow,
  AdwDialog,
  AdwOverlaySplitView,
  AdwSwitchRow,
  AdwTabView,
} from "c:Adw-1";
import {
  GtkActionBar,
  GtkBox,
  GtkBuilder,
  GtkButton,
  GtkCalendar,
  GtkCheckButton,
  GtkColumnView,
  GtkColumnViewColumn,
  GtkDropDown,
  GtkEmojiChooser,
  GtkEntry,
  GtkFlowBox,
  GtkImage,
  GtkLabel,
  GtkMenuButton,
  GtkPasswordEntry,
  GtkPicture,
  GtkPopover,
  GtkRange,
  GtkSpinButton,
  GtkSwitch,
  GtkTextView,
  GtkToggleButton,
  GtkWindow,
  GtkWidget,
  SortType,
  SpinType,
} from "c:Gtk-4.0";
import { ApplicationFlags, g_data_input_stream_new, g_file_new_for_path } from "c:Gio-2.0";
import { GObject } from "c:GObject-2.0";
import {
  g_date_time_new_local,
  g_getenv,
  g_main_context_iteration,
  g_path_get_basename,
  g_source_remove,
  g_timeout_add_full,
  g_variant_new_string,
} from "c:GLib-2.0";

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
function act(kind: string, id: string, args: string[], object: GObject | null, window: GtkWindow): boolean {
  switch (kind) {
    case "draw":
      if (!(object instanceof GtkWidget)) return false;
      draw(window, object);
      return true;
    case "labels":
      if (!(object instanceof GtkWidget)) return false;
      console.log(`${id}.labels ${labels(object).join(",")}`);
      return true;
    case "sort": {
      if (!(object instanceof GtkColumnView)) return false;
      const column = object.columns.get_item(Number(args[0]));
      if (!(column instanceof GtkColumnViewColumn)) return false;
      object.sort_by_column(column, SortType.ASCENDING);
      return true;
    }
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
      if (object instanceof GtkLabel) console.log(`${id}.label ${object.label}`);
      else if (object instanceof GtkMenuButton) console.log(`${id}.label ${object.label}`);
      else if (object instanceof GtkButton) console.log(`${id}.label ${object.label}`);
      else return false;
      return true;
    case "close":
      if (!(object instanceof GtkPopover)) return false;
      object.emit("closed");
      return true;
    case "pick":
      if (!(object instanceof GtkEmojiChooser)) return false;
      object.emit("emoji-picked", args[0]);
      return true;
    case "day": {
      const date = g_date_time_new_local(Number(args[0]), Number(args[1]), Number(args[2]), 0, 0, 0);
      if (!(object instanceof GtkCalendar) || date === null) return false;
      object.select_day(date);
      return true;
    }
    case "active":
      if (object instanceof GtkCheckButton) console.log(`${id}.active ${object.active}`);
      else if (object instanceof GtkToggleButton) console.log(`${id}.active ${object.active}`);
      else if (object instanceof GtkSwitch) console.log(`${id}.active ${object.active}`);
      else if (object instanceof AdwSwitchRow) console.log(`${id}.active ${object.active}`);
      else return false;
      return true;
    case "sensitive":
      if (!(object instanceof GtkWidget)) return false;
      console.log(`${id}.sensitive ${object.sensitive}`);
      return true;
    case "visible":
      if (!(object instanceof GtkWidget)) return false;
      console.log(`${id}.visible ${object.visible}`);
      return true;
    case "icon":
      if (!(object instanceof GtkButton)) return false;
      console.log(`${id}.icon ${object.icon_name}`);
      return true;
    case "value":
      if (object instanceof GtkSpinButton) object.set_value(Number(args[0]));
      else if (object instanceof GtkRange) object.set_value(Number(args[0]));
      else return false;
      return true;
    case "spin":
      if (!(object instanceof GtkSpinButton)) return false;
      object.spin(SpinType.STEP_FORWARD, 1);
      return true;
    case "activate":
      if (object instanceof AdwButtonRow) object.emit("activated");
      else if (object instanceof AdwBanner) object.emit("button-clicked");
      else return false;
      return true;
    case "select":
      if (object instanceof AdwComboRow) object.selected = Number(args[0]);
      else if (object instanceof GtkDropDown) object.selected = Number(args[0]);
      else return false;
      return true;
    case "revealed":
      if (object instanceof GtkActionBar) console.log(`${id}.revealed ${object.revealed}`);
      else if (object instanceof AdwBanner) console.log(`${id}.revealed ${object.revealed}`);
      else return false;
      return true;
    case "children":
      if (!(object instanceof GtkWidget)) return false;
      console.log(`${id}.children ${children(object)}`);
      return true;
    case "orientation":
      if (!(object instanceof GtkBox)) return false;
      console.log(`${id}.orientation ${object.orientation}`);
      return true;
    case "action":
      if (!(object instanceof GtkWidget)) return false;
      object.activate_action(args[0], args.length > 1 ? g_variant_new_string(args[1]) : null);
      return true;
    case "activate-child": {
      const child = object instanceof GtkFlowBox ? object.get_child_at_index(Number(args[0])) : null;
      if (child === null) return false;
      child.activate();
      return true;
    }
    case "file":
      if (object instanceof GtkPicture) console.log(`${id}.file ${object.file?.get_basename() ?? "undefined"}`);
      else if (object instanceof GtkImage) console.log(`${id}.file ${g_path_get_basename(object.file ?? "")}`);
      else return false;
      return true;
    case "sidebar-position":
      if (!(object instanceof AdwOverlaySplitView)) return false;
      console.log(`${id}.sidebar_position ${object.sidebar_position}`);
      return true;
    case "text":
      if (object instanceof GtkPasswordEntry) object.text = args.join(" ");
      else if (object instanceof GtkEntry) object.text = args.join(" ");
      else return false;
      return true;
    case "attributes":
      if (!(object instanceof GtkLabel)) return false;
      console.log(`${id}.attributes ${object.attributes?.to_string() ?? ""}`);
      return true;
    case "pages":
      if (object instanceof AdwTabView) console.log(`${id}.n_pages ${object.n_pages}`);
      else if (object instanceof AdwCarousel) console.log(`${id}.n_pages ${object.n_pages}`);
      else return false;
      return true;
    case "buffer":
      if (!(object instanceof GtkTextView)) return false;
      console.log(`${id}.buffer ${object.buffer.get_char_count()}`);
      return true;
    case "close-dialog":
      if (!(object instanceof AdwDialog)) return false;
      object.close();
      return true;
    case "n-items":
      if (!(object instanceof GtkColumnView)) return false;
      console.log(`${id}.n_items ${object.model?.get_n_items() ?? 0}`);
      return true;
    case "classes":
      if (!(object instanceof GtkWidget)) return false;
      console.log(`${id}.classes ${object.get_css_classes().join(",")}`);
      return true;
    default:
      return false;
  }
}

/**
 * The id of the UI's first object, which Workbench previews: the first
 * `<object` line of the compiled UI, where new-port.sh names one Blueprint
 * leaves unnamed.
 */
function rootId(path: string): string {
  const stream = g_data_input_stream_new(g_file_new_for_path(path).read(null));
  let id = "";
  for (;;) {
    const [line] = stream.read_line_utf8(null);
    if (line === null) break;
    const at = line.indexOf("<object ");
    if (at < 0) continue;
    const start = line.indexOf('id="', at);
    if (start >= 0) id = line.slice(start + 4, line.indexOf('"', start + 4));
    break;
  }
  stream.close(null);
  return id;
}

/** How many children a widget has. */
function children(widget: GtkWidget): number {
  let count = 0;
  for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) count++;
  return count;
}

/**
 * Show the window and run the main loop until `widget` is laid out and two
 * frames have passed since: what a list view's factory binds is drawn only.
 */
function draw(window: GtkWindow, widget: GtkWidget): void {
  window.present();
  // A timer keeps a blocking iteration from waiting on nothing.
  const tick = g_timeout_add_full(0, 5, () => true);
  while (widget.get_width() === 0) g_main_context_iteration(null, true);
  const clock = widget.get_frame_clock();
  if (clock !== null) {
    const start = clock.get_frame_counter();
    widget.queue_resize();
    while (clock.get_frame_counter() < start + 2) g_main_context_iteration(null, true);
  }
  g_source_remove(tick);
}

/** The labels below a widget, depth first, onto `out`. */
function labels(widget: GtkWidget, out: string[] = []): string[] {
  for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
    if (child instanceof GtkLabel) out.push(child.label);
    labels(child, out);
  }
  return out;
}

function drive(builder: GtkBuilder, window: GtkWindow, path: string): void {
  for (const words of actions(path)) {
    const [kind, id] = words;
    if (!act(kind, id, words.slice(2), builder.get_object(id), window)) console.log("driver: cannot " + kind + " " + id);
  }
}

/** Run `demo` as Workbench does, then drive it, then quit. */
export function run(demo: (workbench: Workbench) => void): void {
  const dir = g_getenv("NTS_CORPUS_DEMO") ?? ".";
  // The original's directory, where its assets are: what `resolve` is
  // relative to, as in Workbench.
  const upstream = g_getenv("NTS_CORPUS_UPSTREAM") ?? dir;
  const application = new AdwApplication({ application_id: "dev.nts.Corpus", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    const window = new AdwApplicationWindow({ application });
    const builder = new GtkBuilder({});
    builder.add_from_file(dir + "/main.ui");
    // Previewed as Workbench previews it: in the window, unless it is one.
    const root = builder.get_object(rootId(dir + "/main.ui"));
    if (root instanceof GtkWidget && !(root instanceof GtkWindow)) window.content = root;
    demo({
      application,
      window,
      builder,
      resolve: (path) => g_file_new_for_path(upstream).resolve_relative_path(path).get_uri(),
    });
    drive(builder, window, dir + "/driver.txt");
    g_timeout_add_full(0, 0, () => {
      application.quit();
      return false;
    });
  });
  application.run([]);
}
