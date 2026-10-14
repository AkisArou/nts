// Workbench's "Revealer" demo (CC0, workbenchdev/demos), ported.
import { g_file_new_for_uri } from "c:Gio-2.0";
import { GtkPicture, GtkRevealer, GtkToggleButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const button_slide = workbench.builder.get_object("button_slide");
  const button_crossfade = workbench.builder.get_object("button_crossfade");
  const revealer_slide = workbench.builder.get_object("revealer_slide");
  const revealer_crossfade = workbench.builder.get_object("revealer_crossfade");
  const image1 = workbench.builder.get_object("image1");
  const image2 = workbench.builder.get_object("image2");
  if (
    !(button_slide instanceof GtkToggleButton) ||
    !(button_crossfade instanceof GtkToggleButton) ||
    !(revealer_slide instanceof GtkRevealer) ||
    !(revealer_crossfade instanceof GtkRevealer) ||
    !(image1 instanceof GtkPicture) ||
    !(image2 instanceof GtkPicture)
  ) {
    throw new Error("the demo's UI");
  }

  image1.file = g_file_new_for_uri(workbench.resolve("./image1.png"));
  image2.file = g_file_new_for_uri(workbench.resolve("./image2.png"));

  button_slide.connect("toggled", () => {
    revealer_slide.reveal_child = button_slide.active;
  });

  button_crossfade.connect("toggled", () => {
    revealer_crossfade.reveal_child = button_crossfade.active;
  });

  revealer_slide.connect("notify::child-revealed", () => {
    if (revealer_slide.child_revealed) {
      console.log("Slide Revealer Shown");
    } else {
      console.log("Slide Revealer Hidden");
    }
  });
}

run(demo);
