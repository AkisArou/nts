// Widgets and patterns every GTK application uses: a stack and its
// switcher, a grid, a spin button, a switch, a drop-down over a string list.
//
// The log:
//   label 42.000000  the spin button's `value`, set by assignment, carried to
//                 the label by `spin.bind_property("value", label, "label")`
//                 -- GObject's method, whose instance C takes as `gpointer`
//   notified 1    `notify::active` on the switch, set by assignment
//   picked blue   `notify::selected` on the drop-down, read back through its
//                 model
//   page choices  `stack.visible_child_name = "choices"`: a property read as
//                 `string | null` and written as `string`, an accessor pair
//   request 140   `width_request`, which has no setter or getter method:
//                 written and read through `g_object_set`/`g_object_get`
//   drawn true width 300  `Canvas`'s `vfunc_snapshot`, drawing with
//                 `GtkSnapshot` once GTK renders the window, whose width is
//                 `default_width` -- another property with no setter
import {
  GtkApplication,
  GtkApplicationWindow,
  GtkBox,
  GtkDropDown,
  GtkGrid,
  GtkLabel,
  GtkSpinButton,
  GtkStack,
  GtkStackSwitcher,
  GtkStringList,
  GtkSnapshot,
  GtkSwitch,
  GtkWidget,
  Orientation,
} from "c:Gtk-4.0";
import { GdkRGBA } from "c:Gdk-4.0";
import { graphene_rect_t } from "c:Graphene-1.0";
import { g_timeout_add_full } from "c:GLib-2.0";
import { ApplicationFlags } from "c:Gio-2.0";
import { BindingFlags } from "c:GObject-2.0";

// A widget that draws itself, as GTK 4 draws: a render node per frame.
class Canvas extends GtkWidget {
  drawn = 0;
  width = 0;
  vfunc_snapshot(snapshot: GtkSnapshot): void {
    const color = new GdkRGBA();
    color.parse("tomato");
    const bounds = new graphene_rect_t();
    bounds.init(0, 0, this.get_width(), this.get_height());
    snapshot.append_color(color, bounds);
    this.drawn++;
    this.width = this.get_width();
  }
}

function open(app: GtkApplication): void {
  const stack = new GtkStack({});
  const switcher = new GtkStackSwitcher({ stack });
  const grid = new GtkGrid({ column_spacing: 6, row_spacing: 6 });
  const spin = GtkSpinButton.new_with_range(0, 100, 1);
  const label = new GtkLabel({ label: "0" });
  grid.attach(new GtkLabel({ label: "Value" }), 0, 0, 1, 1);
  grid.attach(spin, 1, 0, 1, 1);
  grid.attach(label, 2, 0, 1, 1);
  stack.add_titled(grid, "numbers", "Numbers");
  const toggle = new GtkSwitch({});
  const choices = new GtkStringList({ strings: ["red", "green", "blue"] });
  const drop = new GtkDropDown({ model: choices });
  const page = new GtkBox({ orientation: Orientation.VERTICAL });
  page.append(toggle);
  page.append(drop);
  stack.add_titled(page, "choices", "Choices");
  let notified = 0;
  toggle.connect("notify::active", () => {
    notified++;
  });
  let picked = "";
  drop.connect("notify::selected", () => {
    picked = choices.get_string(drop.selected) ?? "?";
  });
  spin.bind_property("value", label, "label", BindingFlags.DEFAULT);
  const column = new GtkBox({ orientation: Orientation.VERTICAL });
  column.append(switcher);
  column.append(stack);
  const canvas = new Canvas({ height_request: 40 });
  canvas.width_request = 140;
  column.append(canvas);
  const window = new GtkApplicationWindow({ application: app, title: "Widgets", child: column, default_width: 300 });
  window.present();
  spin.value = 42;
  toggle.active = true;
  drop.selected = 2;
  stack.visible_child_name = "choices";
  console.log(
    "label " + (label.label ?? "") + " notified " + String(notified) + " picked " + picked + " page " + (stack.visible_child_name ?? ""),
  );
  console.log("request " + String(canvas.width_request));
  g_timeout_add_full(0, 300, () => {
    console.log("drawn " + String(canvas.drawn > 0) + " width " + String(canvas.width));
    app.quit();
    return false;
  });
}

function main(): void {
  const app = new GtkApplication({ application_id: "dev.nts.Probe2", flags: ApplicationFlags.NON_UNIQUE });
  app.connect("activate", () => {
    open(app);
  });
  app.run(["probe"]);
}

main();
