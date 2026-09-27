// Workbench's "Action Bar" demo (CC0, workbenchdev/demos), ported.
import { GtkActionBar, GtkButton, GtkToggleButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const action_bar = workbench.builder.get_object("action_bar");
  const button = workbench.builder.get_object("button");
  const start_widget = workbench.builder.get_object("start_widget");
  const end_widget = workbench.builder.get_object("end_widget");
  if (
    !(action_bar instanceof GtkActionBar) ||
    !(button instanceof GtkToggleButton) ||
    !(start_widget instanceof GtkButton) ||
    !(end_widget instanceof GtkButton)
  ) {
    throw new Error("the demo's UI");
  }

  button.connect("notify::active", () => {
    action_bar.revealed = !button.active;
  });

  start_widget.connect("clicked", () => {
    console.log("Start widget");
  });

  end_widget.connect("clicked", () => {
    console.log("End widget");
  });
}

run(demo);
