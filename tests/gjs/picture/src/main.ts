// Workbench's "Picture" demo (CC0, workbenchdev/demos), ported.
import { g_file_new_for_uri } from "c:Gio-2.0";
import { GtkPicture } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const picture_fill = workbench.builder.get_object("picture_fill");
  const picture_contain = workbench.builder.get_object("picture_contain");
  const picture_cover = workbench.builder.get_object("picture_cover");
  const picture_scale_down = workbench.builder.get_object("picture_scale_down");
  if (
    !(picture_fill instanceof GtkPicture) ||
    !(picture_contain instanceof GtkPicture) ||
    !(picture_cover instanceof GtkPicture) ||
    !(picture_scale_down instanceof GtkPicture)
  ) {
    throw new Error("the demo's UI");
  }

  const file = g_file_new_for_uri(workbench.resolve("./keys.png"));

  picture_fill.file = file;
  picture_contain.file = file;
  picture_cover.file = file;
  picture_scale_down.file = file;
}

run(demo);
