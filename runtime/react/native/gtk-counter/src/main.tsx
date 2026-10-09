// Renders the counter into a window, runs GLib's loop until React has
// committed, clicks the button twice, and logs the label after each step.

import { gtk_init, GtkLabel, GtkWindow } from "c:Gtk-4.0";
import { g_main_loop_new, g_timeout_add_full } from "c:GLib-2.0";
import type { CNumber } from "c:types";
import { react_gtk_emit, react_gtk_log } from "c:react-gtk-shim";
import { createContainer, updateContainer } from "react-reconciler/ReactFiberReconciler.ts";
import { ConcurrentRoot } from "react-reconciler/ReactRootTags.ts";
import { WindowRoot } from "./ReactFiberConfig.ts";
import { Box, Button, Label } from "react-gtk";

function ignoreError(): void {}

// Runs the main loop for `ms`: the scheduler's work and timers run in it.
function settle(ms: CNumber<"uint">): void {
  const loop = g_main_loop_new(null, false);
  g_timeout_add_full(0, ms, () => {
    loop.quit();
    return false;
  });
  loop.run();
}

function labelText(container: WindowRoot): string {
  const box = container.window.get_child();
  const first = box === null ? null : box.get_first_child();
  return first instanceof GtkLabel ? String(first.get_label()) : "no label";
}

function main(): void {
  gtk_init();
  const container = new WindowRoot(new GtkWindow(), []);
  const root = createContainer(container, ConcurrentRoot, null, false, false, "", ignoreError, ignoreError, ignoreError, () => {}, null);
  let clicks = 0;
  const render = (text: string): void => {
    updateContainer(
      <Box spacing={6}>
        <Label label={text} />
        <Button label="Add" onClicked={() => clicks++} />
      </Box>,
      root,
      null,
      null,
    );
  };
  render("first");
  settle(50);
  react_gtk_log("mounted " + labelText(container));
  render("second");
  settle(50);
  react_gtk_log("updated " + labelText(container));
  const box = container.window.get_child();
  const button = box === null ? null : box.get_last_child();
  if (button !== null) {
    react_gtk_emit(button, "clicked");
    react_gtk_log("clicked " + String(clicks));
  }
}

main();
