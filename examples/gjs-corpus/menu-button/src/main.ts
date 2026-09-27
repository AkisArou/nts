// Workbench's "Menu Button" demo (CC0, workbenchdev/demos), ported.
import { AdwSwitchRow } from "c:Adw-1";
import { GtkMenuButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const circular_switch = workbench.builder.get_object("circular_switch");
  const secondary_button = workbench.builder.get_object("secondary");
  if (!(circular_switch instanceof AdwSwitchRow) || !(secondary_button instanceof GtkMenuButton)) throw new Error("the demo's UI");

  circular_switch.connect("notify::active", () => {
    if (circular_switch.active) {
      secondary_button.add_css_class("circular");
    } else {
      secondary_button.remove_css_class("circular");
    }
  });
}

run(demo);
