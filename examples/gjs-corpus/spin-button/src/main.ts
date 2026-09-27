// Workbench's "Spin Button" demo (CC0, workbenchdev/demos), ported.
import { GtkSpinButton, SpinType } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const hours = workbench.builder.get_object("hours");
  const minutes = workbench.builder.get_object("minutes");
  if (!(hours instanceof GtkSpinButton) || !(minutes instanceof GtkSpinButton)) {
    throw new Error("the demo's UI");
  }

  hours.text = "00";
  minutes.text = "00";

  hours.connect("value-changed", () => {
    console.log(tellTime(hours, minutes));
  });

  hours.connect("output", () => {
    const value = hours.adjustment.value;
    const text = value.toString().padStart(2, "0");
    hours.text = text;
    return true;
  });

  minutes.connect("output", () => {
    const value = minutes.adjustment.value;
    const text = value.toString().padStart(2, "0");
    minutes.text = text;
    return true;
  });

  minutes.connect("value-changed", () => {
    console.log(tellTime(hours, minutes));
  });

  // This only works for one direction
  // Add any extra logic to account for wrapping in both directions
  minutes.connect("wrapped", () => {
    hours.spin(SpinType["STEP_FORWARD"], 1);
  });
}

function tellTime(hours: GtkSpinButton, minutes: GtkSpinButton): string {
  return `The time selected is ${hours.text}:${minutes.text}`;
}

run(demo);
