// Workbench's "Spinner" demo (CC0, workbenchdev/demos), ported.
import { AdwSpinner } from "c:Adw-1";
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const button = workbench.builder.get_object("button");
  const spinner = workbench.builder.get_object("spinner");
  if (!(button instanceof GtkButton) || !(spinner instanceof AdwSpinner)) throw new Error("the demo's UI");

  button.connect("clicked", () => {
    if (spinner.visible === true) {
      button.icon_name = "media-playback-start";
      spinner.visible = false;
    } else {
      button.icon_name = "media-playback-stop";
      spinner.visible = true;
    }
  });
}

run(demo);
