// Workbench's "Image" demo (CC0, workbenchdev/demos), ported.
import { g_file_new_for_uri } from "c:Gio-2.0";
import { GtkImage } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const icon1 = workbench.builder.get_object("icon1");
  const icon2 = workbench.builder.get_object("icon2");
  const icon3 = workbench.builder.get_object("icon3");
  if (!(icon1 instanceof GtkImage) || !(icon2 instanceof GtkImage) || !(icon3 instanceof GtkImage)) {
    throw new Error("the demo's UI");
  }

  const path = g_file_new_for_uri(workbench.resolve("workbench.png")).get_path();

  icon1.file = path;
  icon2.file = path;
  icon3.file = path;
}

run(demo);
