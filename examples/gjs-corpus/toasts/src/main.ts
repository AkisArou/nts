// Workbench's "Toasts" demo (CC0, workbenchdev/demos), ported.
import { AdwToast, AdwToastOverlay, ToastPriority } from "c:Adw-1";
import { GSimpleAction } from "c:Gio-2.0";
import { g_variant_new_string, g_variant_type_new } from "c:GLib-2.0";
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const overlay = workbench.builder.get_object("overlay");
  const button_simple = workbench.builder.get_object("button_simple");
  const button_advanced = workbench.builder.get_object("button_advanced");
  if (!(overlay instanceof AdwToastOverlay) || !(button_simple instanceof GtkButton) || !(button_advanced instanceof GtkButton)) {
    throw new Error("the demo's UI");
  }

  // Arrows where the original declares functions: TypeScript keeps the
  // narrowing above only in what cannot be called before it.
  const simple = (): void => {
    const toast = new AdwToast({
      title: "Toasts are delicious!",
      timeout: 1,
    });
    toast.connect("dismissed", () => {
      button_simple.sensitive = true;
    });
    overlay.add_toast(toast);
    button_simple.sensitive = false;
  };
  button_simple.connect("clicked", simple);

  const advanced = (): void => {
    const message_id = "42";
    const toast = new AdwToast({
      title: "Message sent",
      button_label: "Undo",
      action_name: "win.undo",
      action_target: g_variant_new_string(message_id),
      priority: ToastPriority.HIGH,
    });
    overlay.add_toast(toast);
  };

  button_advanced.connect("clicked", advanced);

  const action_console = new GSimpleAction({
    name: "undo",
    parameter_type: g_variant_type_new("s"),
  });
  action_console.connect("activate", (_self, target) => {
    // GJS unpacks the variant with `unpack()`; the binding reads it as the
    // string it is.
    const value = target!.get_string()[0];
    console.log(`undo ${value}`);
  });
  workbench.window.add_action(action_console);
}

run(demo);
