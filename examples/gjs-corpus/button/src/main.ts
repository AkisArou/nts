// Workbench's "Button" demo (CC0, workbenchdev/demos src/Button/main.js),
// ported: the demo's own code, in the function the host calls once the
// builder has the demo's UI.
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function onClicked(button: GtkButton): void {
  console.log(`${button.name} clicked`);
}

function demo(workbench: Workbench): void {
  const button_ids = [
    "regular",
    "flat",
    "suggested",
    "destructive",
    "custom",
    "disabled",
    "circular-plus",
    "circular-minus",
    "pill",
    "osd-left",
    "osd-right",
  ];
  for (const id of button_ids) {
    const button = workbench.builder.get_object(id);
    if (button instanceof GtkButton) button.connect("clicked", onClicked);
  }
}

run(demo);
