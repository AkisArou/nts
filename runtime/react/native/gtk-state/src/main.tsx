// M2: a function component's useState. Renders the counter, clicks its
// button twice through GTK's signal, and logs the label React re-rendered.

import { gtk_init, GtkLabel, GtkWindow } from "c:Gtk-4.0";
import { g_main_loop_new, g_timeout_add_full } from "c:GLib-2.0";
import type { CNumber } from "c:types";
import { react_gtk_emit, react_gtk_log } from "c:react-gtk-shim";
import { createContainer, updateContainer } from "react-reconciler/ReactFiberReconciler.ts";
import { ConcurrentRoot } from "react-reconciler/ReactRootTags.ts";
import { WindowRoot } from "./ReactFiberConfig.ts";
import { Counter } from "./Counter.tsx";

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
  updateContainer(<Counter />, root, null, null);
  settle(50);
  react_gtk_log("mounted " + labelText(container));
  for (let i = 1; i <= 2; i++) {
    const box = container.window.get_child();
    const button = box === null ? null : box.get_last_child();
    if (button !== null) {
      react_gtk_emit(button, "clicked");
    }
    settle(50);
    react_gtk_log("clicked " + labelText(container));
  }
}

main();
