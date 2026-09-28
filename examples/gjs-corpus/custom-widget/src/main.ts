// Workbench's "Custom Widget" demo (CC0, workbenchdev/demos), ported.
import { GtkButton, GtkFlowBox } from "c:Gtk-4.0";
import { run, template, type Workbench } from "../../host/workbench.ts";

// GJS's `registerClass({ GTypeName, Template: workbench.template })`, as
// the class's statics: the template is the demo's UI, which the host reads
// as this module runs.
class AwesomeButton extends GtkButton {
  static readonly GTypeName = "AwesomeButton";
  static readonly template: string = template ?? "";

  onclicked(): void {
    console.log("Clicked");
  }
}

function demo(workbench: Workbench): void {
  const container = new GtkFlowBox({
    hexpand: true,
  });

  for (let i = 0; i < 100; i++) {
    const widget = new AwesomeButton();
    container.append(widget);
  }

  workbench.preview(container);
}

run(demo);
