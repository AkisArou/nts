// Workbench's "Checkboxes" demo (CC0, workbenchdev/demos), ported.
import { GtkCheckButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const checkbox_1 = workbench.builder.get_object("checkbox_1");
  const checkbox_2 = workbench.builder.get_object("checkbox_2");
  if (!(checkbox_1 instanceof GtkCheckButton) || !(checkbox_2 instanceof GtkCheckButton)) throw new Error("the demo's UI");

  checkbox_1.connect("toggled", () => {
    if (checkbox_1.active) console.log("Notifications Enabled");
    else console.log("Notifications Disabled");
  });

  checkbox_2.connect("toggled", () => {
    if (checkbox_2.active) console.log("Changes will be auto-saved");
    else console.log("Changes will not be auto-saved");
  });
}

run(demo);
