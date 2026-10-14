// Workbench's "Separator" demo (CC0, workbenchdev/demos), ported.
import { g_file_new_for_uri } from "c:Gio-2.0";
import { GtkPicture } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const picture_one = workbench.builder.get_object("picture_one");
  const picture_two = workbench.builder.get_object("picture_two");
  if (!(picture_one instanceof GtkPicture) || !(picture_two instanceof GtkPicture)) {
    throw new Error("the demo's UI");
  }

  const file = g_file_new_for_uri(workbench.resolve("./image.png"));

  picture_one.file = file;
  picture_two.file = file;
}

run(demo);
