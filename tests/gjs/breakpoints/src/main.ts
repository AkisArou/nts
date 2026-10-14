// Workbench's "Breakpoints" demo (CC0, workbenchdev/demos), ported.
import { AdwBreakpoint } from "c:Adw-1";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const breakpoint = workbench.builder.get_object("breakpoint");
  if (!(breakpoint instanceof AdwBreakpoint)) throw new Error("the demo's UI");

  breakpoint.connect("apply", () => {
    console.log("Breakpoint Applied");
  });

  breakpoint.connect("unapply", () => {
    console.log("Breakpoint Unapplied");
  });
}

run(demo);
