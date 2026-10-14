// Workbench's "Styling with CSS" demo (CC0, workbenchdev/demos), ported.
import { GtkLabel } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const basic_label = workbench.builder.get_object("basic_label");
  if (!(basic_label instanceof GtkLabel)) throw new Error("the demo's UI");

  basic_label.add_css_class("my_custom_class");
}

run(demo);
