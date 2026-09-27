// Workbench's "Stack" demo (CC0, workbenchdev/demos), ported.
import { AdwComboRow } from "c:Adw-1";
import { GtkBox, GtkSeparator, GtkStack, GtkStackSidebar, GtkStackSwitcher, GtkWidget, Orientation } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const root_box = workbench.builder.get_object("root_box");
  const stack = workbench.builder.get_object("stack");
  const navigation_row = workbench.builder.get_object("navigation_row");
  if (!(root_box instanceof GtkBox) || !(stack instanceof GtkStack) || !(navigation_row instanceof AdwComboRow)) {
    throw new Error("the demo's UI");
  }

  let navigation_widget: GtkWidget;
  let separator: GtkWidget | null = null;

  if (navigation_row.get_selected() === 0) {
    navigation_widget = new GtkStackSwitcher({ stack: stack });
    root_box.prepend(navigation_widget);
  } else {
    navigation_widget = new GtkStackSidebar({ stack: stack });
    root_box.prepend(navigation_widget);
  }

  navigation_row.connect("notify::selected-item", () => {
    if (navigation_row.get_selected() === 0) {
      root_box.remove(navigation_widget);
      // The original passes `separator` before it is ever set, which GTK
      // answers with a critical and nothing removed: the same, without one.
      if (separator !== null) root_box.remove(separator);
      navigation_widget = new GtkStackSwitcher({ stack: stack });
      root_box.prepend(navigation_widget);
      root_box.orientation = Orientation.VERTICAL;
    } else {
      root_box.remove(navigation_widget);
      navigation_widget = new GtkStackSidebar({ stack: stack });
      separator = new GtkSeparator({});
      root_box.prepend(separator);
      root_box.prepend(navigation_widget);
      root_box.orientation = Orientation.HORIZONTAL;
    }
  });
}

run(demo);
