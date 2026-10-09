// Workbench's "Clamp" demo (CC0, workbenchdev/demos), ported.
import { AdwClamp } from "c:Adw-1";
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const button_increase = workbench.builder.get_object("button_increase");
  const button_decrease = workbench.builder.get_object("button_decrease");
  const clamp = workbench.builder.get_object("clamp");
  if (!(button_increase instanceof GtkButton) || !(button_decrease instanceof GtkButton) || !(clamp instanceof AdwClamp)) {
    throw new Error("the demo's UI");
  }

  // Arrows where the original declares functions: TypeScript keeps the
  // narrowing above only in what cannot be called before it.
  const increase = (): void => {
    const current_size = clamp.get_maximum_size();
    const current_threshold = clamp.get_tightening_threshold();
    // Sizes are C `int`s: a step past the largest stays the largest.
    clamp.maximum_size = Math.min(current_size + 300, 2147483647);
    clamp.tightening_threshold = Math.min(current_threshold + 200, 2147483647);

    if (clamp.tightening_threshold === 1000) {
      console.log("Maximum size reached");
    }
  };

  const decrease = (): void => {
    const current_size = clamp.get_maximum_size();
    const current_threshold = clamp.get_tightening_threshold();
    clamp.maximum_size = Math.max(current_size - 300, -2147483648);
    clamp.tightening_threshold = Math.max(current_threshold - 200, -2147483648);

    if (clamp.tightening_threshold === 0) {
      console.log("Minimum size reached");
    }
  };

  button_increase.connect("clicked", increase);
  button_decrease.connect("clicked", decrease);
}

run(demo);
