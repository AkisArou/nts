// Workbench's "Flow Box" demo (CC0, workbenchdev/demos), ported.
import { AdwBin } from "c:Adw-1";
import { GtkFlowBox, GtkLabel } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const flowbox = workbench.builder.get_object("flowbox");
  if (!(flowbox instanceof GtkFlowBox)) throw new Error("the demo's UI");

  for (let code = 128513; code <= 128591; code++) {
    addEmoji(flowbox, String.fromCodePoint(code));
  }

  flowbox.connect("child-activated", (_self, item) => {
    // FlowBoxChild -> AdwBin -> Label, each a widget TypeScript narrows
    const bin = item.child;
    if (!(bin instanceof AdwBin)) return;
    const label = bin.child;
    if (!(label instanceof GtkLabel)) return;
    const emoji = label.label;
    console.log("Unicode:", emoji.codePointAt(0)!.toString(16));
  });
}

function addEmoji(flowbox: GtkFlowBox, unicode: string): void {
  const item = new AdwBin({
    child: new GtkLabel({
      vexpand: true,
      hexpand: true,
      label: unicode,
      css_classes: ["emoji"],
    }),
    width_request: 100,
    height_request: 100,
    css_classes: ["card"],
  });
  flowbox.append(item);
}

run(demo);
