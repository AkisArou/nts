// Workbench's "Switch" demo (CC0, workbenchdev/demos), ported.
import { GtkLabel, GtkSwitch } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const switch_on = workbench.builder.get_object("switch_on");
  const label_on = workbench.builder.get_object("label_on");

  const switch_off = workbench.builder.get_object("switch_off");
  const label_off = workbench.builder.get_object("label_off");
  if (
    !(switch_on instanceof GtkSwitch) ||
    !(label_on instanceof GtkLabel) ||
    !(switch_off instanceof GtkSwitch) ||
    !(label_off instanceof GtkLabel)
  ) {
    throw new Error("the demo's UI");
  }

  switch_on.connect("notify::active", () => {
    label_on.label = switch_on.active ? "On" : "Off";
    switch_off.active = !switch_on.active;
  });

  switch_off.connect("notify::active", () => {
    label_off.label = switch_off.active ? "On" : "Off";
    switch_on.active = !switch_off.active;
  });
}

run(demo);
