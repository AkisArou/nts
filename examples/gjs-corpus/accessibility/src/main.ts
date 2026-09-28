// Workbench's "Accessibility" demo (CC0, workbenchdev/demos), ported.
import { AdwBin } from "c:Adw-1";
import { GDK_KEY_ISO_Enter, GDK_KEY_KP_Enter, GDK_KEY_KP_Space, GDK_KEY_Return, GDK_KEY_space } from "c:Gdk-4.0";
import { G_TYPE_INT, GValue } from "c:GObject-2.0";
import {
  AccessibleState,
  AccessibleTristate,
  GtkEventControllerKey,
  GtkGestureClick,
  StateFlags,
  type GtkWidget,
} from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const button = workbench.builder.get_object("custom_button");
  if (!(button instanceof AdwBin)) throw new Error("the demo's UI");

  const clicker = new GtkGestureClick({});
  clicker.connect("released", () => toggleButton(button));
  button.add_controller(clicker);

  const key_controller = new GtkEventControllerKey({});
  key_controller.connect("key-released", (_controller, keyval) => {
    const keyvals = [GDK_KEY_space, GDK_KEY_KP_Space, GDK_KEY_Return, GDK_KEY_ISO_Enter, GDK_KEY_KP_Enter];

    if (keyvals.includes(keyval)) toggleButton(button);
  });
  button.add_controller(key_controller);
}

function toggleButton(button: GtkWidget): void {
  let checked = (button.get_state_flags() & StateFlags.CHECKED) !== 0;
  let pressed: AccessibleTristate;

  // Invert the current state
  checked = !checked;
  if (checked) {
    pressed = AccessibleTristate.TRUE;
  } else {
    pressed = AccessibleTristate.FALSE;
  }

  // Update the accessible state
  const state = new GValue();
  state.init(G_TYPE_INT);
  state.set_int(pressed);
  button.update_state([AccessibleState.PRESSED], [state]);

  // Update the widget state (i.e. CSS pseudo-class)
  if (checked) button.set_state_flags(StateFlags.CHECKED, false);
  else button.unset_state_flags(StateFlags.CHECKED);

  // Grab the focus
  button.grab_focus();
}

run(demo);
