// Workbench's "Link Button" demo (CC0, workbenchdev/demos), ported.
import { GtkLinkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const linkbutton = workbench.builder.get_object("linkbutton");
  if (!(linkbutton instanceof GtkLinkButton)) throw new Error("the demo's UI");

  linkbutton.connect("notify::visited", () => {
    console.log("The link has been visited");
  });

  linkbutton.connect("activate-link", (button) => {
    console.log(`About to activate ${button.uri}`);

    // Return true if handling the link manually, or
    // false to let the default behavior continue
    return false;
  });
}

run(demo);
