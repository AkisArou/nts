// Workbench's "Toggle Button" demo (CC0, workbenchdev/demos), ported.
import { GtkToggleButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const buttons = {
    button_no_look: "Don't look",
    button_look: "Look",
    button_camera: "Camera",
    button_flashlight: "Flashlight",
    button_console: "Console",
  };

  for (const [id, name] of Object.entries(buttons)) {
    const button = workbench.builder.get_object(id);
    if (!(button instanceof GtkToggleButton)) throw new Error("the demo's UI");
    button.connect("notify::active", () => {
      console.log(`${name} ${button.active ? "On" : "Off"}`);
    });
  }
}

run(demo);
