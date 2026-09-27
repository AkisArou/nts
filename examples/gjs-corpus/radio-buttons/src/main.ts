// Workbench's "Radio Buttons" demo (CC0, workbenchdev/demos), ported.
import { GtkCheckButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const radio_button_1 = workbench.builder.get_object("radio_button_1");
  const radio_button_2 = workbench.builder.get_object("radio_button_2");
  if (!(radio_button_1 instanceof GtkCheckButton) || !(radio_button_2 instanceof GtkCheckButton)) throw new Error("the demo's UI");

  radio_button_1.connect("toggled", () => {
    if (radio_button_1.active) console.log("Force Light Mode");
  });

  radio_button_2.connect("toggled", () => {
    if (radio_button_2.active) console.log("Force Dark Mode");
  });
}

run(demo);
