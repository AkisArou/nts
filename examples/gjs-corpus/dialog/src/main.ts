// Workbench's "Dialog" demo (CC0, workbenchdev/demos), ported.
import { AdwDialog } from "c:Adw-1";
import { g_file_new_for_uri } from "c:Gio-2.0";
import { GtkButton, GtkImage } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const dialog = workbench.builder.get_object("dialog");
  const button = workbench.builder.get_object("button");
  const image = workbench.builder.get_object("image");
  if (!(dialog instanceof AdwDialog) || !(button instanceof GtkButton) || !(image instanceof GtkImage)) {
    throw new Error("the demo's UI");
  }

  image.file = g_file_new_for_uri(workbench.resolve("image.svg")).get_path();

  button.connect("clicked", () => {
    dialog.present(workbench.window);
  });

  dialog.connect("close-attempt", () => {
    console.log("Close Attempt");
    dialog.force_close();
  });

  dialog.connect("closed", () => {
    console.log("Closed");
  });
}

run(demo);
