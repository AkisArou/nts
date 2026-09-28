// Workbench's "Shortcuts Window" demo (CC0, workbenchdev/demos), ported.
import { GtkButton, GtkShortcutsWindow } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const shortcuts_window = workbench.builder.get_object("shortcuts_window");
  const button = workbench.builder.get_object("button");
  if (!(shortcuts_window instanceof GtkShortcutsWindow) || !(button instanceof GtkButton)) {
    throw new Error("the demo's UI");
  }

  button.connect("clicked", () => {
    shortcuts_window.present();
  });
}

run(demo);
