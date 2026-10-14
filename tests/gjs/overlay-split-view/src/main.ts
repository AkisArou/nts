// Workbench's "Overlay Split View" demo (CC0, workbenchdev/demos), ported.
import { AdwOverlaySplitView } from "c:Adw-1";
import { GtkToggleButton, PackType } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const split_view = workbench.builder.get_object("split_view");
  const start_toggle = workbench.builder.get_object("start_toggle");
  const end_toggle = workbench.builder.get_object("end_toggle");
  if (
    !(split_view instanceof AdwOverlaySplitView) ||
    !(start_toggle instanceof GtkToggleButton) ||
    !(end_toggle instanceof GtkToggleButton)
  ) {
    throw new Error("the demo's UI");
  }

  start_toggle.connect("toggled", () => {
    split_view.sidebar_position = PackType.START;
  });

  end_toggle.connect("toggled", () => {
    split_view.sidebar_position = PackType.END;
  });
}

run(demo);
