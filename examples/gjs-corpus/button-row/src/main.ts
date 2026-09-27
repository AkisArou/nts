// Workbench's "Button Row" demo (CC0, workbenchdev/demos), ported.
import { AdwButtonRow } from "c:Adw-1";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const button_row_suggested = workbench.builder.get_object("button_row_suggested");
  const button_row_destructive = workbench.builder.get_object("button_row_destructive");
  if (!(button_row_suggested instanceof AdwButtonRow) || !(button_row_destructive instanceof AdwButtonRow)) {
    throw new Error("the demo's UI");
  }

  button_row_suggested.connect("activated", () => {
    console.log("Suggested button row activated");
  });
  button_row_destructive.connect("activated", () => {
    console.log("Destructive button row activated");
  });
}

run(demo);
