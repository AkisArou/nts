// Workbench's "Boxed Lists" demo (CC0, workbenchdev/demos), ported.
import { AdwComboRow } from "c:Adw-1";
import { G_TYPE_STRING } from "c:GObject-2.0";
import { GtkCClosureExpression, GtkStringObject } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const drop_down = workbench.builder.get_object("drop_down");
  if (!(drop_down instanceof AdwComboRow)) throw new Error("the demo's UI");

  drop_down.connect("notify::selected-item", () => {
    const selected_item = drop_down.selected_item;
    if (!(selected_item instanceof GtkStringObject)) return;
    console.log(selected_item.get_string());
  });

  // GJS's `new Gtk.ClosureExpression(type, fn, null)` is C's constructor
  // here, as GJS spells every other: the function's `this` is any object.
  const expression = GtkCClosureExpression.new(G_TYPE_STRING, (obj) => (obj instanceof GtkStringObject ? obj.string : null));
  drop_down.expression = expression;
}

run(demo);
