// Workbench's "Overlay" demo (CC0, workbenchdev/demos), ported.
import { g_file_new_for_uri } from "c:Gio-2.0";
import { GtkPicture } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const file = g_file_new_for_uri(workbench.resolve("./image.png"));

  const picture = workbench.builder.get_object("picture");
  if (!(picture instanceof GtkPicture)) throw new Error("the demo's UI");
  picture.file = file;
}

run(demo);
