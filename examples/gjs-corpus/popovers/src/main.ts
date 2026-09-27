// Workbench's "Popovers" demo (CC0, workbenchdev/demos), ported.
import { GtkPopover } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const popover_ids = ["plain_popover", "popover_menu"];

  for (const id of popover_ids) {
    const popover = workbench.builder.get_object(id);
    if (!(popover instanceof GtkPopover)) throw new Error("the demo's UI");
    popover.connect("closed", onClosed);
  }

  function onClosed(popover: GtkPopover): void {
    console.log(`${popover.name} closed.`);
  }
}

run(demo);
