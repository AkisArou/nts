// Workbench's "Scale" demo (CC0, workbenchdev/demos), ported.
import { GtkScale, GtkScaleButton, PositionType } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const scale_one = workbench.builder.get_object("one");
  const scale_two = workbench.builder.get_object("two");
  const scale_button = workbench.builder.get_object("button");
  if (!(scale_one instanceof GtkScale) || !(scale_two instanceof GtkScale) || !(scale_button instanceof GtkScaleButton)) {
    throw new Error("the demo's UI");
  }

  const marks: Record<number, string> = {
    0: "A",
    50: "B",
    100: "C",
  };

  const volume_icons = [
    "audio-volume-muted-symbolic",
    "audio-volume-high-symbolic",
    "audio-volume-low-symbolic",
    "audio-volume-medium-symbolic",
  ];

  for (const [value, label] of Object.entries(marks)) {
    scale_two.add_mark(Number(value), PositionType.RIGHT, label);
  }

  scale_two.set_increments(25, 100);

  scale_one.connect("value-changed", () => {
    const scale_value = scale_one.get_value();
    if (scale_value === scale_one.adjustment.upper) {
      console.log("Maximum value reached");
    } else if (scale_value === scale_one.adjustment.lower) {
      console.log("Minimum value reached");
    }
  });

  scale_two.connect("value-changed", () => {
    const scale_value = scale_two.get_value();
    const label = marks[scale_value];
    if (!label) return;

    console.log(`Mark ${label} reached`);
  });

  scale_button.icons = volume_icons;
}

run(demo);
