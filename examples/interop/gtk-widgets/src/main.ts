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
  GtkSwitch,
  Orientation,
} from "c:Gtk-4.0";
import { ApplicationFlags } from "c:Gio-2.0";
import { BindingFlags } from "c:GObject-2.0";

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
  const window = new GtkApplicationWindow({ application: app, title: "Probe", child: column });
  window.present();
  spin.value = 42;
  toggle.active = true;
  drop.selected = 2;
  stack.visible_child_name = "choices";
  console.log(
    "label " + (label.label ?? "") + " notified " + String(notified) + " picked " + picked + " page " + (stack.visible_child_name ?? ""),
  );
  app.quit();
}

function main(): void {
  const app = new GtkApplication({ application_id: "dev.nts.Probe2", flags: ApplicationFlags.NON_UNIQUE });
  app.connect("activate", () => {
    open(app);
  });
  app.run(["probe"]);
}

main();
